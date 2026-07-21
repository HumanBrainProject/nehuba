/**
 * Backend (chunk-worker) counterpart of the SWC skeleton source.
 *
 * This module registers a shared object that runs in the chunk worker. It must
 * be imported by the custom worker bundle (`src/chunk_worker.custom.ts`) so the
 * worker recognises `SWCSourceParameters.RPC_ID`; otherwise the RPC to
 * construct this source fails with "constructorFunction is not a constructor".
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
