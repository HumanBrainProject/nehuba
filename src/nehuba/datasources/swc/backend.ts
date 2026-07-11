/**
 * Backend (chunk-worker) counterpart of the SWC skeleton source.
 *
 * ⚠️ NOT YET WIRED UP. This module registers a shared object that must run in
 * the chunk worker, but nehuba_v2 currently uses neuroglancer's *prebuilt*
 * chunk worker (`lib/chunk_worker.bundle.js`, spawned by
 * `DataManagementContext`), which has no hook for injecting custom backend RPC
 * classes. Until a custom worker bundle is set up (import neuroglancer's worker
 * registrations + this module, then construct the `Viewer` with a
 * `DataManagementContext` that points at it), the `swc://` data source will not
 * be able to load: the worker will not recognise the `SWCSourceParameters.RPC_ID`.
 *
 * See TODO.md ("SWC worker backend") for the remaining work.
 */
import { WithParameters } from "neuroglancer/unstable/chunk_manager/backend.js";
import { WithSharedKvStoreContextCounterpart } from "neuroglancer/unstable/kvstore/backend.js";
import { readKvStore } from "neuroglancer/unstable/kvstore/index.js";
import { SkeletonSource } from "neuroglancer/unstable/skeleton/backend.js";
import type { SkeletonChunk } from "neuroglancer/unstable/skeleton/backend.js";
import { decodeSwcSkeletonChunk } from "neuroglancer/unstable/skeleton/decode_swc_skeleton.js";
import { registerSharedObject } from "neuroglancer/unstable/worker_rpc.js";
import { SWCSourceParameters } from "./base";

// `as any`: works around the lossy generated `.d.ts` mixin typings (see the
// note in ../frontend.ts and TODO.md).
export class SWCSkeletonSource extends (WithParameters(
  WithSharedKvStoreContextCounterpart(SkeletonSource) as any,
  SWCSourceParameters,
) as any) {
  kvStore = this.sharedKvStoreContext.kvStoreContext.getKvStore(
    this.parameters.url,
  );

  async download(chunk: SkeletonChunk, signal: AbortSignal) {
    const { kvStore } = this;
    const response = await readKvStore(kvStore.store, kvStore.path, {
      signal,
      throwIfMissing: true,
    });
    const swcStr = new TextDecoder("utf-8").decode(
      await response.response.arrayBuffer(),
    );
    decodeSwcSkeletonChunk(chunk, swcStr);
  }
}

// Applied as a plain call rather than a decorator: the generated `.d.ts`
// declares `registerSharedObject` as a legacy single-argument decorator, which
// TypeScript's standard-decorator checking (this project has no
// `experimentalDecorators`) rejects against the `as any` base class above.
registerSharedObject()(SWCSkeletonSource as any);
