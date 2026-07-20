/**
 * A base kvstore provider for the `blob:` protocol, so that ad-hoc object URLs
 * created via `URL.createObjectURL(blob)` can be used as neuroglancer data
 * sources (e.g. `blob:http://host/uuid|nehuba-nifti:`).
 *
 * Stock neuroglancer only registers `http`/`https`/`gs`/`s3`/... base kvstores,
 * so a `blob:` URL fails with either:
 *   - `Invalid base kvstore protocol "blob:"`, or
 *   - `blob: scheme does not support | URL pipelines`
 * (the latter because, with no matching base kvstore provider, the pipeline
 * falls through to the non-kvstore datasource path which rejects `|`).
 *
 * Registering a `blob:` base kvstore provider fixes both without patching
 * neuroglancer. An object URL is an opaque single file, so the store exposes
 * exactly one key (the empty string) and fetches the URL directly. Blob URL
 * fetches honour `Range` requests in modern browsers, so offset/suffix reads
 * are supported too.
 *
 * NOTE: because the frontend and the chunk worker are separate bundles with
 * separate copies of the registry, this module must be imported for its side
 * effects in BOTH bundles — see src/nehuba/datasources/index.ts (frontend) and
 * src/chunk_worker.custom.ts (worker).
 */
import type { BaseKvStoreProvider } from "neuroglancer/unstable/kvstore/context.js";
import type {
  DriverReadOptions,
  KvStore,
  ReadResponse,
  StatOptions,
  StatResponse,
} from "neuroglancer/unstable/kvstore/index.js";
import { KvStoreFileHandle, NotFoundError } from "neuroglancer/unstable/kvstore/index.js";
import { frontendBackendIsomorphicKvStoreProviderRegistry } from "neuroglancer/unstable/kvstore/register.js";

const SCHEME = "blob";

function parseContentRange(contentRange: string) {
  const m = contentRange.match(/bytes ([0-9]+)-([0-9]+)\/([0-9]+|\*)/);
  if (m === null) {
    throw new Error(`Invalid content-range header: ${JSON.stringify(contentRange)}`);
  }
  const offset = parseInt(m[1], 10);
  const endPos = parseInt(m[2], 10);
  const totalSize = m[3] === "*" ? undefined : parseInt(m[3], 10);
  return { offset, length: endPos - offset + 1, totalSize };
}

/**
 * Single-file kvstore backed by an object URL. The only valid key is the empty
 * string; the whole blob is the file.
 */
class BlobKvStore implements KvStore {
  singleKey = true;
  supportsOffsetReads = true;
  supportsSuffixReads = true;

  constructor(public blobUrl: string) {}

  getUrl() {
    return this.blobUrl;
  }

  async stat(
    key: string,
    options: StatOptions,
  ): Promise<StatResponse | undefined> {
    // Blob URLs don't support HEAD; probe size with a one-byte range GET.
    const response = await fetch(this.blobUrl, {
      signal: options.signal,
      headers: { range: "bytes=0-0" },
    });
    if (!response.ok && response.status !== 206) {
      return this.handleMissing(key, options, response);
    }
    const contentRange = response.headers.get("content-range");
    let totalSize: number | undefined;
    if (response.status === 206 && contentRange !== null) {
      ({ totalSize } = parseContentRange(contentRange));
    } else {
      const len = response.headers.get("content-length");
      totalSize = len === null ? undefined : Number(len);
    }
    return { totalSize };
  }

  async read(
    key: string,
    options: DriverReadOptions,
  ): Promise<ReadResponse | undefined> {
    const { byteRange } = options;
    const headers: Record<string, string> = {};
    if (byteRange !== undefined) {
      if ("suffixLength" in byteRange) {
        headers.range = `bytes=-${byteRange.suffixLength}`;
      } else {
        headers.range = `bytes=${byteRange.offset}-${byteRange.offset + byteRange.length - 1}`;
      }
    }
    const response = await fetch(this.blobUrl, {
      signal: options.signal,
      headers: byteRange === undefined ? undefined : headers,
    });
    if (!response.ok && response.status !== 206) {
      return this.handleMissing(key, options, response);
    }

    let offset = 0;
    let length: number | undefined;
    let totalSize: number | undefined;
    const contentRange = response.headers.get("content-range");
    if (response.status === 206 && contentRange !== null) {
      ({ offset, length, totalSize } = parseContentRange(contentRange));
    } else {
      const len = response.headers.get("content-length");
      length = totalSize = len === null ? undefined : Number(len);
    }
    return { response, offset, length, totalSize };
  }

  private handleMissing(
    key: string,
    options: { throwIfMissing?: boolean },
    response: Response,
  ): undefined {
    if (response.status === 404) {
      if (options.throwIfMissing === true) {
        throw new NotFoundError(new KvStoreFileHandle(this, key));
      }
      return undefined;
    }
    throw new Error(
      `Error reading ${JSON.stringify(this.blobUrl)}: HTTP ${response.status}`,
    );
  }
}

const blobProvider: BaseKvStoreProvider = {
  scheme: SCHEME,
  description: "blob: object URL",
  getKvStore(parsedUrl) {
    // The whole `blob:...` URL is the single file; there is no path within it.
    return { store: new BlobKvStore(parsedUrl.url), path: "" };
  },
};

// Isomorphic: the same provider works on both the main thread and the worker,
// since both just `fetch()` the object URL.
frontendBackendIsomorphicKvStoreProviderRegistry.registerBaseKvStoreProvider(
  () => blobProvider,
);
