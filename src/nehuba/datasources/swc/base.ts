/**
 * Parameters shared between the SWC skeleton frontend and backend sources.
 *
 * `url` is a kvStore pipeline URL that resolves to the SWC file to fetch.
 */
export class SWCSourceParameters {
  declare url: string;

  static RPC_ID = "nehuba/swc/SkeletonSource";
}
