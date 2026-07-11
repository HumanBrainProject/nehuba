import { WithParameters } from "neuroglancer/unstable/chunk_manager/frontend.js";
import {
  makeCoordinateSpace,
  makeIdentityTransform,
} from "neuroglancer/unstable/coordinate_transform.js";
import type {
  DataSource,
  DataSourceProvider,
  GetDataSourceOptions,
} from "neuroglancer/unstable/datasource/index.js";
import { WithSharedKvStoreContext } from "neuroglancer/unstable/kvstore/chunk_source_frontend.js";
import { SkeletonSource } from "neuroglancer/unstable/skeleton/frontend.js";
import { mat4 } from "neuroglancer/unstable/util/geom.js";
import { SWCSourceParameters } from "./base";

// `as any`: works around the lossy generated `.d.ts` mixin typings (see the
// equivalent note in ../precompmesh/frontend.ts and TODO.md).
class SWCSkeletonSource extends WithParameters(
  WithSharedKvStoreContext(SkeletonSource) as any,
  SWCSourceParameters,
) {}

function getDefaultCoordinateSpace() {
  return makeCoordinateSpace({
    names: ["x", "y", "z"],
    units: ["m", "m", "m"],
    scales: Float64Array.of(1e-9, 1e-9, 1e-9),
  });
}

/**
 * Loads a single SWC neuron file as a skeleton.
 *
 * Usage: `swc://https://host/path/to/neuron.swc`
 *
 * ⚠️ Frontend-only for now: loading requires the SWC backend
 * ({@link ./backend}) to be registered in the chunk worker, which nehuba_v2's
 * prebuilt-worker setup does not yet support. See TODO.md and ./backend.ts.
 */
export class SWCDataSource implements DataSourceProvider {
  scheme = "swc";

  get description() {
    return "SWC neuron file";
  }

  async get(options: GetDataSourceOptions): Promise<DataSource> {
    const { registry } = options;
    const { sharedKvStoreContext } = registry;
    const url = options.providerUrl;
    return registry.chunkManager.memoize.getAsync(
      { type: "swc:get", url },
      options,
      async (): Promise<DataSource> => {
        return {
          modelTransform: makeIdentityTransform(getDefaultCoordinateSpace()),
          subsources: [
            {
              id: "default",
              default: true,
              subsource: {
                mesh: registry.chunkManager.getChunkSource(
                  SWCSkeletonSource as any,
                  {
                    sharedKvStoreContext,
                    parameters: { url },
                  },
                ) as any,
              },
              subsourceToModelSubspaceTransform: mat4.create(),
            },
          ],
        };
      },
    );
  }
}
