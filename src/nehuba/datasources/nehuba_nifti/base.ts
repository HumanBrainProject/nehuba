/**
 * Shared (frontend + backend) definitions for the `nehuba-nifti` data source.
 *
 * `nehuba-nifti` is a customised NIfTI source. It differs from neuroglancer's
 * built-in `nifti` source in two ways (both implemented in ./backend.ts):
 *
 *  1. If the NIfTI header leaves `xyzt_units` unset, the spatial units are
 *     assumed to be millimetres and the temporal unit seconds (mm / sec), so
 *     the voxel dimensions from `pixDims` are still applied.
 *  2. The volume is always served as `uint8`, with every voxel value linearly
 *     normalised between the global min and max of the array. Computing the
 *     min/max requires reading every value, which is done once in the chunk
 *     worker (see ./backend.ts).
 *
 * The RPC ids are distinct from the upstream `nifti/*` ids so the two sources
 * can coexist in the same chunk worker.
 */
import type { DataType } from "neuroglancer/unstable/sliceview/volume/base.js";

export const GET_NEHUBA_NIFTI_VOLUME_INFO_RPC_ID =
  "nehuba-nifti/getVolumeInfo";

export interface NehubaNiftiVolumeInfo {
  rank: number;
  sourceNames: string[];
  viewNames: string[];
  viewScales: Float64Array;
  sourceScales: Float64Array;
  units: string[];
  dataType: DataType;
  transform: Float64Array;
  description: string;
  volumeSize: Uint32Array;
}

export class VolumeSourceParameters {
  declare url: string;

  static RPC_ID = "nehuba-nifti/VolumeChunkSource";
}
