/** Each worker entry's bundled code, built once per test process by the official dry-run (#1782). */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { bundleLikeWrangler } from "./wrangler-bundle.ts";

/** One official dry-run build in a scratch directory; only the bundled code outlives it. */
async function buildInScratch(entry: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "edge-bundled-entry-"));
  try {
    return (await bundleLikeWrangler(entry, join(directory, "worker.js"))).code;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Bundles keyed by entry. Bindings are Miniflare options, not bundle input, so every test on one
 * entry runs the same code with the bindings it asked for; the build is paid once per entry.
 */
export class BundledEntries {
  readonly #code = new Map<string, Promise<string>>();
  readonly #build: (entry: string) => Promise<string>;

  constructor(build: (entry: string) => Promise<string> = buildInScratch) {
    this.#build = build;
  }

  /** The entry's bundled code, from the first build of that entry in this process. */
  code(entry: string): Promise<string> {
    const built = this.#code.get(entry) ?? this.#build(entry);
    this.#code.set(entry, built);
    return built;
  }

  /** Miniflare's module options for the entry: its bundle as one in-memory ES module. */
  async modules(entry: string) {
    const path = basename(entry).replace(/\.[cm]?ts$/, ".js");
    return { modules: [{ type: "ESModule" as const, path, contents: await this.code(entry) }] };
  }
}

/** The one instance the host lane's worker builders share for the life of their test process. */
export const bundledEntries = new BundledEntries();
