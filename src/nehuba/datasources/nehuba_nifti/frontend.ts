/**
 * Frontend for the `nehuba-nifti` data source. Adapted from neuroglancer's
 * `datasource/nifti/frontend.ts`; the coordinate space and (always-uint8) data
 * type come from the backend (see ./backend.ts and ./base.ts).
 *
 * Registered as a kvstore-based provider (like upstream nifti), so it is usable
 * both as `<kvstore-url>|nehuba-nifti:` and, via the legacy adapter, as
 * `nehuba-nifti://<url>`.
 */
import { makeDataBoundsBoundingBoxAnnotationSet } from "neuroglancer/unstable/annotation/index.js";
import { WithParameters } from "neuroglancer/unstable/chunk_manager/frontend.js";
import {
  makeCoordinateSpace,
  makeIdentityTransformedBoundingBox,
} from "neuroglancer/unstable/coordinate_transform.js";
import type {
  DataSource,
  GetKvStoreBasedDataSourceOptions,
  KvStoreBasedDataSourceProvider,
} from "neuroglancer/unstable/datasource/index.js";
import { WithSharedKvStoreContext } from "neuroglancer/unstable/kvstore/chunk_source_frontend.js";
import type { SharedKvStoreContext } from "neuroglancer/unstable/kvstore/frontend.js";
import { ensureEmptyUrlSuffix } from "neuroglancer/unstable/kvstore/url.js";
import type { VolumeSourceOptions } from "neuroglancer/unstable/sliceview/volume/base.js";
import {
  makeVolumeChunkSpecificationWithDefaultCompression,
  VolumeType,
} from "neuroglancer/unstable/sliceview/volume/base.js";
import {
  MultiscaleVolumeChunkSource,
  VolumeChunkSource,
} from "neuroglancer/unstable/sliceview/volume/frontend.js";
import * as matrix from "neuroglancer/unstable/util/matrix.js";
import type { ProgressOptions } from "neuroglancer/unstable/util/progress_listener.js";
import type { NehubaNiftiVolumeInfo } from "./base";
import {
  GET_NEHUBA_NIFTI_VOLUME_INFO_RPC_ID,
  VolumeSourceParameters,
} from "./base";

// `as any`: works around neuroglancer's lossy generated `.d.ts` mixin typings
// (see the note in ../precompmesh/frontend.ts and TODO.md).
class NehubaNiftiVolumeChunkSource extends WithParameters(
  WithSharedKvStoreContext(VolumeChunkSource as any) as any,
  VolumeSourceParameters,
) {}

class NehubaNiftiMultiscaleVolumeChunkSource extends (MultiscaleVolumeChunkSource as any) {
  constructor(
    public sharedKvStoreContext: SharedKvStoreContext,
    public url: string,
    public info: NehubaNiftiVolumeInfo,
  ) {
    super(sharedKvStoreContext.chunkManager);
  }
  get dataType() {
    return this.info.dataType;
  }
  get volumeType() {
    return VolumeType.UNKNOWN;
  }
  get rank() {
    return this.info.rank;
  }
  getSources(volumeSourceOptions: VolumeSourceOptions) {
    const { info } = this;
    const chunkToMultiscaleTransform = matrix.createIdentity(
      Float32Array,
      info.rank + 1,
    );
    const spec = makeVolumeChunkSpecificationWithDefaultCompression({
      rank: info.rank,
      volumeType: VolumeType.UNKNOWN,
      chunkDataSize: info.volumeSize,
      dataType: info.dataType,
      upperVoxelBound: Float32Array.from(info.volumeSize),
      chunkToMultiscaleTransform,
      volumeSourceOptions,
    });
    return [
      [
        {
          chunkSource: this.chunkManager.getChunkSource(
            NehubaNiftiVolumeChunkSource as any,
            {
              sharedKvStoreContext: this.sharedKvStoreContext,
              spec,
              parameters: { url: this.url },
            },
          ),
          chunkToMultiscaleTransform,
        },
      ],
    ];
  }
}

function getNiftiVolumeInfo(
  sharedKvStoreContext: SharedKvStoreContext,
  url: string,
  options: Partial<ProgressOptions>,
) {
  return sharedKvStoreContext.chunkManager.rpc!.promiseInvoke<NehubaNiftiVolumeInfo>(
    GET_NEHUBA_NIFTI_VOLUME_INFO_RPC_ID,
    {
      sharedKvStoreContext: sharedKvStoreContext.rpcId,
      url: url,
    },
    { signal: options.signal, progressListener: options.progressListener },
  );
}

function getDataSource(
  sharedKvStoreContext: SharedKvStoreContext,
  url: string,
  options: Partial<ProgressOptions>,
) {
  return sharedKvStoreContext.chunkManager.memoize.getAsync(
    { type: "nehuba-nifti/getVolume", url },
    options,
    async (progressOptions) => {
      const info = await getNiftiVolumeInfo(
        sharedKvStoreContext,
        url,
        progressOptions,
      );
      const volume = new NehubaNiftiMultiscaleVolumeChunkSource(
        sharedKvStoreContext,
        url,
        info,
      );
      const box = {
        lowerBounds: new Float64Array(info.rank),
        upperBounds: Float64Array.from(info.volumeSize),
      };
      const inputSpace = makeCoordinateSpace({
        rank: info.rank,
        names: info.sourceNames,
        scales: info.sourceScales,
        units: info.units,
        boundingBoxes: [makeIdentityTransformedBoundingBox(box)],
      });
      const outputSpace = makeCoordinateSpace({
        rank: info.rank,
        names: info.viewNames,
        scales: info.viewScales,
        units: info.units,
      });
      const dataSource: DataSource = {
        canonicalUrl: `${url}|nehuba-nifti:`,
        subsources: [
          {
            id: "default",
            default: true,
            subsource: { volume },
          },
          {
            id: "bounds",
            default: true,
            subsource: {
              staticAnnotations: makeDataBoundsBoundingBoxAnnotationSet(box),
            },
          },
        ],
        modelTransform: {
          sourceRank: info.rank,
          rank: info.rank,
          inputSpace,
          outputSpace,
          transform: info.transform,
        },
      };
      return dataSource;
    },
  );
}

export class NehubaNiftiDataSource implements KvStoreBasedDataSourceProvider {
  get scheme() {
    return "nehuba-nifti";
  }
  get description() {
    return "NIfTI (nehuba: uint8-normalised, mm/sec default units)";
  }
  get singleFile() {
    return true;
  }
  get(options: GetKvStoreBasedDataSourceOptions): Promise<DataSource> {
    ensureEmptyUrlSuffix(options.url);
    return getDataSource(
      options.registry.sharedKvStoreContext,
      options.kvStoreUrl,
      options,
    );
  }
}
