import { registerProvider } from "neuroglancer/unstable/datasource/default_provider.js";
import { SWCDataSource } from "./frontend";

// NOTE: registering the frontend provider makes the `swc://` scheme resolvable,
// but skeletons will not actually load until the backend
// (./backend) is registered in the chunk worker. See TODO.md.
registerProvider(new SWCDataSource());
