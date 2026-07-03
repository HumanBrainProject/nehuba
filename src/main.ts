// Side-effect import: registers datasources, layer types and kvstores.
// The bare "neuroglancer" entry point exposes no named exports.
import "neuroglancer";

// The public API lives under the "neuroglancer/unstable/*" subpath,
// which the package's exports map resolves to its built `lib/*.js`.
import { setupDefaultViewer } from "neuroglancer/unstable/ui/default_viewer_setup.js";

const container = document.getElementById("neuroglancer-container");
if (!container) {
  throw new Error("Missing #neuroglancer-container element");
}

const viewer = setupDefaultViewer({ target: container });
console.log(viewer);
