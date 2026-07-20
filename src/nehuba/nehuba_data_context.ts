/**
 * A {@link DataManagementContext} replacement that spawns nehuba's *custom*
 * chunk worker (src/chunk_worker.custom.ts) instead of neuroglancer's prebuilt
 * one, so custom backend RPC classes (e.g. `nehuba-nifti`) are available.
 *
 * The body mirrors neuroglancer's `DataManagementContext`
 * (node_modules/neuroglancer/lib/data_management_context.js) — the only change
 * is the worker URL. It is intentionally not a subclass: the upstream
 * constructor creates the (prebuilt) worker itself, with no seam to override.
 */
import {
  CapacitySpecification,
  ChunkManager,
  ChunkQueueManager,
} from "neuroglancer/unstable/chunk_manager/frontend.js";
import type { FrameNumberCounter } from "neuroglancer/unstable/chunk_manager/frontend.js";
import { RefCounted } from "neuroglancer/unstable/util/disposable.js";
import type { GL } from "neuroglancer/unstable/webgl/context.js";
import { RPC } from "neuroglancer/unstable/worker_rpc.js";

export class NehubaDataManagementContext extends RefCounted {
  worker: Worker;
  chunkQueueManager: ChunkQueueManager;
  chunkManager: ChunkManager;

  constructor(
    public gl: GL,
    public frameNumberCounter: FrameNumberCounter,
  ) {
    super();
    this.worker = new Worker(
      new URL("../chunk_worker.custom.ts", import.meta.url),
      { type: "module" },
    );
    this.chunkQueueManager = this.registerDisposer(
      new ChunkQueueManager(
        new RPC(this.worker, /*waitUntilReady=*/ true),
        this.gl,
        this.frameNumberCounter,
        {
          gpuMemory: new CapacitySpecification({
            defaultItemLimit: 1e6,
            defaultSizeLimit: 1e9,
          }),
          systemMemory: new CapacitySpecification({
            defaultItemLimit: 1e7,
            defaultSizeLimit: 2e9,
          }),
          download: new CapacitySpecification({
            defaultItemLimit: 100,
            defaultSizeLimit: Number.POSITIVE_INFINITY,
          }),
          compute: new CapacitySpecification({
            defaultItemLimit: 128,
            defaultSizeLimit: 5e8,
          }),
        },
      ),
    );
    this.chunkQueueManager.registerDisposer(() => this.worker.terminate());
    this.chunkManager = this.registerDisposer(
      new ChunkManager(this.chunkQueueManager),
    );
  }

  get rpc(): RPC {
    return this.chunkQueueManager.rpc!;
  }
}
