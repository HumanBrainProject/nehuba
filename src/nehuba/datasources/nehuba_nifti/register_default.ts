/**
 * Registers the `nehuba-nifti` frontend provider. As with upstream nifti, it is
 * registered both as a kvstore-based provider (`<url>|nehuba-nifti:`) and, via
 * the legacy url adapter, as a scheme (`nehuba-nifti://<url>`).
 *
 * NOTE: the frontend only resolves the scheme; volumes will not load unless the
 * matching backend (./backend.ts) runs in the chunk worker. nehuba_v2 wires
 * this up through its custom worker bundle (src/chunk_worker.custom.ts) and
 * NehubaDataManagementContext.
 */
import {
  registerKvStoreBasedDataProvider,
  registerProvider,
} from "neuroglancer/unstable/datasource/default_provider.js";
import { KvStoreBasedDataSourceLegacyUrlAdapter } from "neuroglancer/unstable/datasource/index.js";
import { NehubaNiftiDataSource } from "./frontend";

const provider = new NehubaNiftiDataSource();
registerKvStoreBasedDataProvider(provider);
registerProvider(new KvStoreBasedDataSourceLegacyUrlAdapter(provider));
