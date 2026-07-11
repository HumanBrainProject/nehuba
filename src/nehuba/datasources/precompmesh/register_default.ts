import { registerProvider } from "neuroglancer/unstable/datasource/default_provider.js";
import { PrecompMeshDataSource } from "./frontend";

registerProvider(new PrecompMeshDataSource());
