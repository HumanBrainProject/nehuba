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
import { MeshSourceParameters } from "neuroglancer/unstable/datasource/precomputed/base.js";
import { getJsonMetadata } from "neuroglancer/unstable/datasource/precomputed/frontend.js";
import { WithSharedKvStoreContext } from "neuroglancer/unstable/kvstore/chunk_source_frontend.js";
import {
  kvstoreEnsureDirectoryPipelineUrl,
  resolveRelativePath,
} from "neuroglancer/unstable/kvstore/url.js";
import { MeshSource } from "neuroglancer/unstable/mesh/frontend.js";
import { mat4 } from "neuroglancer/unstable/util/geom.js";
import { verifyObjectProperty, verifyString } from "neuroglancer/unstable/util/json.js";

/**
 * Reuses the upstream Precomputed (single-resolution) mesh backend, which is
 * registered in the chunk worker whenever the `precomputed` data source is
 * enabled (see vite.config.ts). Because the RPC id is taken from
 * {@link MeshSourceParameters}, the frontend source below is handled by the
 * already-registered `precomputed/MeshSource` backend counterpart — no custom
 * worker code is required.
 */
// The `as any` casts work around neuroglancer's lossy generated `.d.ts`: the
// emitted declarations for `WithSharedKvStoreContext`/`WithParameters` do not
// compose (the mixin return type drops its base's members), so composing them
// statically collapses to `never`. This mirrors how the rest of nehuba deals
// with the upstream typings gap (see patches.ts / TODO.md).
class PrecomputedMeshSource extends WithParameters(
  WithSharedKvStoreContext(MeshSource) as any,
  MeshSourceParameters,
) {}

function getDefaultCoordinateSpace() {
  return makeCoordinateSpace({
    names: ["x", "y", "z"],
    units: ["m", "m", "m"],
    scales: Float64Array.of(1e-9, 1e-9, 1e-9),
  });
}

/**
 * Loads a Precomputed mesh directly (without an accompanying volume), given a
 * directory that contains an `info` file of the form `{"mesh": "<subdir>"}`.
 *
 * Usage: `precompmesh://https://host/path/to/dataset`
 */
export class PrecompMeshDataSource implements DataSourceProvider {
  scheme = "precompmesh";

  get description() {
    return "Precomputed mesh.";
  }

  async get(options: GetDataSourceOptions): Promise<DataSource> {
    const { registry } = options;
    const { sharedKvStoreContext } = registry;
    const baseUrl = kvstoreEnsureDirectoryPipelineUrl(options.providerUrl);
    return registry.chunkManager.memoize.getAsync(
      { type: "precompmesh:get", baseUrl },
      options,
      async (progressOptions): Promise<DataSource> => {
        const metadata = await getJsonMetadata(
          sharedKvStoreContext,
          baseUrl,
          /*required=*/ true,
          progressOptions,
        );
        const mesh = verifyObjectProperty(metadata, "mesh", verifyString);
        const meshUrl = kvstoreEnsureDirectoryPipelineUrl(
          resolveRelativePath(baseUrl, mesh),
        );
        return {
          modelTransform: makeIdentityTransform(getDefaultCoordinateSpace()),
          subsources: [
            {
              id: "default",
              default: true,
              subsource: {
                mesh: registry.chunkManager.getChunkSource(
                  PrecomputedMeshSource as any,
                  {
                    sharedKvStoreContext,
                    parameters: { url: meshUrl, lod: 0 },
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
