/**
 * Chunk-worker backend for the `nehuba-nifti` data source.
 *
 * Adapted from neuroglancer's `datasource/nifti/backend.ts`, with two
 * behavioural changes (see ./base.ts for the rationale):
 *
 *  1. `xyzt_units` defaulting: unset spatial units are treated as millimetres
 *     and unset temporal units as seconds.
 *  2. uint8 normalisation: the whole image is read once (in this worker) to
 *     find the global min/max, and every voxel is linearly rescaled into
 *     `[0, 255]` and served as `uint8`.
 *
 * This module must be loaded in the custom chunk worker
 * (`src/chunk_worker.custom.ts`) so that the RPC ids in ./base.ts are
 * recognised there.
 */
import type { NIFTI2 } from "nifti-reader-js";
import { isCompressed, NIFTI1, readHeader, readImage } from "nifti-reader-js";
import { WithParameters } from "neuroglancer/unstable/chunk_manager/backend.js";
import { getCachedDecodedUrl } from "neuroglancer/unstable/chunk_manager/generic_file_source.js";
import type { SharedKvStoreContextCounterpart } from "neuroglancer/unstable/kvstore/backend.js";
import { WithSharedKvStoreContextCounterpart } from "neuroglancer/unstable/kvstore/backend.js";
import type { ReadResponse } from "neuroglancer/unstable/kvstore/index.js";
import { decodeRawChunk } from "neuroglancer/unstable/sliceview/backend_chunk_decoders/raw.js";
import type { VolumeChunk } from "neuroglancer/unstable/sliceview/volume/backend.js";
import { VolumeChunkSource } from "neuroglancer/unstable/sliceview/volume/backend.js";
import { DataType } from "neuroglancer/unstable/sliceview/volume/base.js";
import { Endianness } from "neuroglancer/unstable/util/endian.js";
import {
  kOneVec,
  mat4,
  quat,
  translationRotationScaleZReflectionToMat4,
  vec3,
} from "neuroglancer/unstable/util/geom.js";
import { decodeGzip } from "neuroglancer/unstable/util/gzip.js";
import * as matrix from "neuroglancer/unstable/util/matrix.js";
import type { ProgressOptions } from "neuroglancer/unstable/util/progress_listener.js";
import type { RPCPromise } from "neuroglancer/unstable/worker_rpc.js";
import {
  registerPromiseRPC,
  registerSharedObject,
} from "neuroglancer/unstable/worker_rpc.js";
import type { NehubaNiftiVolumeInfo } from "./base";
import {
  GET_NEHUBA_NIFTI_VOLUME_INFO_RPC_ID,
  VolumeSourceParameters,
} from "./base";

enum NiftiDataType {
  NONE = 0,
  BINARY = 1,
  UINT8 = 2,
  INT16 = 4,
  INT32 = 8,
  FLOAT32 = 16,
  COMPLEX64 = 32,
  FLOAT64 = 64,
  RGB24 = 128,
  INT8 = 256,
  UINT16 = 512,
  UINT32 = 768,
  INT64 = 1024,
  UINT64 = 1280,
  FLOAT128 = 1536,
  COMPLEX128 = 1792,
  COMPLEX256 = 2048,
}

/**
 * Reads a single scalar value from `dv` at byte `offset`, for the given NIfTI
 * datatype and endianness. 64-bit integer types are converted to `number`
 * (adequate for min/max + visualisation, may lose precision beyond 2^53).
 */
type ValueReader = (dv: DataView, offset: number) => number;

interface DataTypeReadSpec {
  bytesPerElement: number;
  makeReader: (littleEndian: boolean) => ValueReader;
}

const READ_SPECS = new Map<NiftiDataType, DataTypeReadSpec>([
  [NiftiDataType.UINT8, { bytesPerElement: 1, makeReader: () => (dv, o) => dv.getUint8(o) }],
  [NiftiDataType.INT8, { bytesPerElement: 1, makeReader: () => (dv, o) => dv.getInt8(o) }],
  [NiftiDataType.INT16, { bytesPerElement: 2, makeReader: (le) => (dv, o) => dv.getInt16(o, le) }],
  [NiftiDataType.UINT16, { bytesPerElement: 2, makeReader: (le) => (dv, o) => dv.getUint16(o, le) }],
  [NiftiDataType.INT32, { bytesPerElement: 4, makeReader: (le) => (dv, o) => dv.getInt32(o, le) }],
  [NiftiDataType.UINT32, { bytesPerElement: 4, makeReader: (le) => (dv, o) => dv.getUint32(o, le) }],
  [NiftiDataType.FLOAT32, { bytesPerElement: 4, makeReader: (le) => (dv, o) => dv.getFloat32(o, le) }],
  [NiftiDataType.FLOAT64, { bytesPerElement: 8, makeReader: (le) => (dv, o) => dv.getFloat64(o, le) }],
  [NiftiDataType.INT64, { bytesPerElement: 8, makeReader: (le) => (dv, o) => Number(dv.getBigInt64(o, le)) }],
  [NiftiDataType.UINT64, { bytesPerElement: 8, makeReader: (le) => (dv, o) => Number(dv.getBigUint64(o, le)) }],
]);

class NehubaNiftiFileData {
  declare header: NIFTI1 | NIFTI2;
  /**
   * Whole-volume image data, already normalised into `uint8`. Computed once at
   * decode time (single-chunk source), so downloads are just a copy.
   */
  declare normalized: Uint8Array;
}

/**
 * Reads every voxel of `imageBuffer` (interpreted per `header`) to find the
 * global min/max, then linearly rescales into `[0, 255]` as `uint8`.
 */
function normalizeToUint8(
  header: NIFTI1 | NIFTI2,
  imageBuffer: ArrayBuffer,
): Uint8Array {
  const spec = READ_SPECS.get(header.datatypeCode);
  if (spec === undefined) {
    throw new Error(
      "nehuba-nifti: cannot normalise data type " +
        `${NiftiDataType[header.datatypeCode] || header.datatypeCode}.`,
    );
  }
  const { bytesPerElement, makeReader } = spec;
  const littleEndian = header.littleEndian;
  const read = makeReader(littleEndian);
  const dv = new DataView(imageBuffer);
  const count = Math.floor(imageBuffer.byteLength / bytesPerElement);

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < count; ++i) {
    const v = read(dv, i * bytesPerElement);
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const out = new Uint8Array(count);
  if (!(max > min)) {
    // Constant (or empty) volume: nothing to spread across the range.
    return out;
  }
  const scale = 255 / (max - min);
  for (let i = 0; i < count; ++i) {
    const v = read(dv, i * bytesPerElement);
    out[i] = Math.round((v - min) * scale);
  }
  return out;
}

async function decodeNiftiFile(
  readResponse: ReadResponse,
  options: ProgressOptions,
) {
  let buffer = await readResponse.response.arrayBuffer();
  if (isCompressed(buffer)) {
    buffer = await decodeGzip(buffer, "gzip", options.signal);
  }
  const header = readHeader(buffer);
  if (header === null) {
    throw new Error("Failed to parse NIFTI header.");
  }
  const data = new NehubaNiftiFileData();
  data.header = header;
  data.normalized = normalizeToUint8(header, readImage(header, buffer));
  return { data, size: data.normalized.byteLength };
}

function getNiftiFileData(
  sharedKvStoreContextCounterpart: SharedKvStoreContextCounterpart,
  url: string,
  options: Partial<ProgressOptions>,
) {
  return getCachedDecodedUrl(
    sharedKvStoreContextCounterpart,
    url,
    decodeNiftiFile,
    options,
  );
}

function convertAffine(affine: number[][]) {
  return mat4.fromValues(
    affine[0][0], affine[1][0], affine[2][0], affine[3][0],
    affine[0][1], affine[1][1], affine[2][1], affine[3][1],
    affine[0][2], affine[1][2], affine[2][2], affine[3][2],
    affine[0][3], affine[1][3], affine[2][3], affine[3][3],
  );
}

registerPromiseRPC(
  GET_NEHUBA_NIFTI_VOLUME_INFO_RPC_ID,
  async function (x, progressOptions): RPCPromise<NehubaNiftiVolumeInfo> {
    const sharedKvStoreContext = this.get(
      x.sharedKvStoreContext,
    ) as SharedKvStoreContextCounterpart;
    const { header } = await getNiftiFileData(
      sharedKvStoreContext,
      x.url,
      progressOptions,
    );

    // (1) Default `xyzt_units`: assume mm for space and sec for time when unset.
    const spatialUnitsCode = header.xyzt_units & NIFTI1.SPATIAL_UNITS_MASK;
    let spatialInvScale = 1;
    let spatialUnit = "";
    switch (spatialUnitsCode) {
      case NIFTI1.UNITS_METER:
        spatialInvScale = 1;
        spatialUnit = "m";
        break;
      case NIFTI1.UNITS_MICRON:
        spatialInvScale = 1e6;
        spatialUnit = "m";
        break;
      case NIFTI1.UNITS_MM:
      default:
        // UNITS_MM, or unset (0) -> assume millimetres.
        spatialInvScale = 1e3;
        spatialUnit = "m";
        break;
    }

    const temporalUnitsCode = header.xyzt_units & NIFTI1.TEMPORAL_UNITS_MASK;
    let timeUnit = "";
    let timeInvScale = 1;
    switch (temporalUnitsCode) {
      case NIFTI1.UNITS_MSEC:
        timeUnit = "s";
        timeInvScale = 1e3;
        break;
      case NIFTI1.UNITS_USEC:
        timeUnit = "s";
        timeInvScale = 1e6;
        break;
      case NIFTI1.UNITS_HZ:
        timeUnit = "Hz";
        timeInvScale = 1;
        break;
      case NIFTI1.UNITS_RADS:
        timeUnit = "rad/s";
        timeInvScale = 1;
        break;
      case NIFTI1.UNITS_SEC:
      default:
        // UNITS_SEC, or unset (0) -> assume seconds.
        timeUnit = "s";
        timeInvScale = 1;
        break;
    }

    let units: string[] = [
      spatialUnit, spatialUnit, spatialUnit, timeUnit, "", "", "",
    ];
    let sourceScales = Float64Array.of(
      header.pixDims[1] / spatialInvScale,
      header.pixDims[2] / spatialInvScale,
      header.pixDims[3] / spatialInvScale,
      header.pixDims[4] / timeInvScale,
      header.pixDims[5],
      header.pixDims[6],
      header.pixDims[7],
    );
    let viewScales = Float64Array.of(
      1 / spatialInvScale,
      1 / spatialInvScale,
      1 / spatialInvScale,
      1 / timeInvScale,
      1, 1, 1,
    );
    let sourceNames = ["i", "j", "k", "m", "c^", "c1^", "c2^"];
    let viewNames = ["x", "y", "z", "t", "c^", "c1^", "c2^"];
    const rank = header.dims[0];
    sourceNames = sourceNames.slice(0, rank);
    viewNames = viewNames.slice(0, rank);
    units = units.slice(0, rank);
    sourceScales = sourceScales.slice(0, rank);
    viewScales = viewScales.slice(0, rank);

    const { quatern_b, quatern_c, quatern_d } = header;
    const quatern_a = Math.sqrt(
      1.0 - quatern_b * quatern_b - quatern_c * quatern_c - quatern_d * quatern_d,
    );
    const qfac = header.pixDims[0] === -1 ? -1 : 1;
    const qoffset = vec3.fromValues(
      header.qoffset_x,
      header.qoffset_y,
      header.qoffset_z,
    );
    convertAffine(header.affine); // method-3 transform (unused, mirrors upstream)
    const method2Transform = translationRotationScaleZReflectionToMat4(
      mat4.create(),
      qoffset,
      quat.fromValues(quatern_b, quatern_c, quatern_d, quatern_a),
      kOneVec,
      qfac,
    );
    const transform = matrix.createIdentity(Float64Array, rank + 1);
    const copyRank = Math.min(3, rank);
    for (let row = 0; row < copyRank; ++row) {
      for (let col = 0; col < copyRank; ++col) {
        transform[col * (rank + 1) + row] = method2Transform[col * 4 + row];
      }
      transform[rank * (rank + 1) + row] = method2Transform[12 + row];
    }

    const info: NehubaNiftiVolumeInfo = {
      rank,
      sourceNames,
      viewNames,
      units,
      sourceScales,
      viewScales,
      description: header.description,
      transform,
      // (2) Always served as uint8.
      dataType: DataType.UINT8,
      volumeSize: Uint32Array.from(header.dims.slice(1, 1 + rank)),
    };
    return { value: info };
  },
);

export class NehubaNiftiVolumeChunkSource extends WithParameters(
  WithSharedKvStoreContextCounterpart(VolumeChunkSource) as any,
  VolumeSourceParameters,
) {
  async download(chunk: VolumeChunk, signal: AbortSignal) {
    chunk.chunkDataSize = this.spec.chunkDataSize;
    const data = await getNiftiFileData(
      this.sharedKvStoreContext,
      this.parameters.url,
      { signal },
    );
    // Already normalised to uint8 at decode time; endianness is irrelevant for
    // single-byte data.
    await decodeRawChunk(
      chunk,
      signal,
      data.normalized.buffer as ArrayBuffer,
      Endianness.LITTLE,
    );
  }
}

// Applied as a plain call rather than a decorator: the generated `.d.ts`
// declares `registerSharedObject` as a legacy single-argument decorator, which
// this project's standard-decorator checking rejects against the `as any` base
// class above (mirrors ../swc/backend.ts).
registerSharedObject()(NehubaNiftiVolumeChunkSource as any);
