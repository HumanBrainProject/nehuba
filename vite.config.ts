import { defineConfig } from "vite";

export default defineConfig({
  // Use relative URLs to reference other files, in order to allow built assets
  // to be served from any path.
  base: "",
  resolve: {
    // Include only specific data sources.
    conditions: [
      "neuroglancer/datasource:none_by_default",
      "neuroglancer/datasource/precomputed:enabled",
      "neuroglancer/datasource/nifti:enabled",
      "neuroglancer/datasource/zarr:enabled",
      "neuroglancer/datasource/deepzoom:enabled",
      "neuroglancer/datasource/n5:enabled",
      // Available but not enabled. Uncomment to include (frontend + custom chunk
      // worker + async are all gated by these conditions, so no other changes
      // are needed). See docs: neuroglancer-master/src/datasource/<name>/.
      //
      // No external deps — standalone single-mesh loaders:
      // "neuroglancer/datasource/obj:enabled",       // obj://  Wavefront OBJ mesh
      // "neuroglancer/datasource/vtk:enabled",       // vtk://  VTK mesh
      //
      // Require a matching backend service to be useful:
      // "neuroglancer/datasource/python:enabled",    // python://    neuroglancer Python integration
      // "neuroglancer/datasource/render:enabled",    // render://    Janelia Render web service
      // "neuroglancer/datasource/graphene:enabled",  // graphene://  PyChunkGraph segmentation
      // "neuroglancer/datasource/nggraph:enabled",   // nggraph://   nggraph segmentation graph
      //
      // Auth-gated — also need credential providers + middleauth/ngauth kvstores:
      // "neuroglancer/datasource/boss:enabled",      // boss://      bossDB (requires auth)
      // "neuroglancer/datasource/dvid:enabled",      // dvid://      Janelia DVID (requires auth)
      // "neuroglancer/datasource/brainmaps:enabled", // brainmaps:// Google Brain Maps API (internal)
    ],
  },
  esbuild: {
    // Needed to acommodate decorator usage in Neuroglancer TypeScript sources.
    target: "es2022",
  },
  worker: {
    // Required due to use of dynamic imports in Neuroglancer.
    format: "es",
    rollupOptions: {
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
  build: {
    // Avoid spurious warnings due to large chunks from Neuroglancer.
    chunkSizeWarningLimit: 2 * 1024 * 1024,
    rollupOptions: {
      output: {
        // Disable filename hashing so asset/chunk names are stable and
        // predictable (easier to copy into an Angular build, etc.).
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
  server: {
    port: 8080,
    fs: {
      // Allow serving files from parent neuroglancer project, due to the local
      // path reference.  This would not be needed for projects that depend on
      // Neuroglancer normally, or when using pnpm rather than npm.
      allow: ["../neuroglancer-master", "."],
    },
  },
  optimizeDeps: {
    entries: [
      "index.html",
      // In order for Vite to properly find all of Neuroglancer's transitive
      // dependencies, instruct Vite to search for dependencies starting from
      // all of the bundle entry points.
      //
      // These have to be specified explicitly because vite does not allow globs
      // within `node_modules`.
      "node_modules/neuroglancer/src/main.bundle.js",
      "node_modules/neuroglancer/src/async_computation.bundle.js",
      "node_modules/neuroglancer/src/chunk_worker.bundle.js",
    ],
    // Neuroglancer is incompatible with Vite's optimizeDeps step used for the
    // dev server due to its use of `new URL` syntax (not supported by esbuild).
    exclude: ["neuroglancer"],
  },
});
