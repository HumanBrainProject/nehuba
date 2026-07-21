/**
 * Custom chunk-worker bundle entry point.
 *
 * Mirrors neuroglancer's own `chunk_worker.bundle.js` (all the standard backend
 * registrations, so precomputed / zarr / nifti / meshes still work in the
 * worker) and additionally imports nehuba's custom backend modules.
 *
 * This is spawned by {@link NehubaDataManagementContext}
 * (src/nehuba/nehuba_data_context.ts) instead of neuroglancer's prebuilt
 * worker, which has no hook for injecting custom backend RPC classes.
 */
import "neuroglancer/unstable/util/polyfills.js";
import "neuroglancer/unstable/shared_watchable_value.js";
import "neuroglancer/unstable/chunk_manager/backend.js";
import "neuroglancer/unstable/kvstore/backend.js";
import "neuroglancer/unstable/sliceview/backend.js";
import "neuroglancer/unstable/perspective_view/backend.js";
import "neuroglancer/unstable/volume_rendering/backend.js";
import "neuroglancer/unstable/annotation/backend.js";
import "neuroglancer/unstable/datasource/enabled_backend_modules.js";
import "neuroglancer/unstable/kvstore/enabled_backend_modules.js";
import "neuroglancer/unstable/worker_rpc_context.js";

// Custom `blob:` base kvstore, so object URLs resolve in the worker too.
import "./nehuba/datasources/blob_kvstore/blob_kvstore";

// nehuba custom backends. These register additional RPC ids in this worker.
import "./nehuba/datasources/nehuba_nifti/backend";
import "./nehuba/datasources/swc/backend";
