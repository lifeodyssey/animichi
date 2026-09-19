import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The connection SHAPE (#1628, spec §4.2) — stateless and memoized.
 *
 * `postgresServerless` is replaced so this test measures the construction
 * policy, not the driver: what it counts is how many clients the module builds
 * and how many runtimes one acquire hands back. The contract deserialization
 * the real factory performs is `@prisma/orm-postgres`'s to prove, and the
 * socket behaviour is the Node integration arm's
 * (`nearby-runtime.integration.test.ts`).
 *
 * The memo is module state, so every test imports a FRESH copy of the module
 * (`vi.resetModules`) — otherwise the first test would consume the only client
 * the rest could observe, and a dropped memoization would still look green.
 *
 * The graph is warmed below, in the file's import phase. Loading it cold inside
 * a test spends that transform against the pool's per-test budget, which is what
 * timed the first test out in the 94-file suite — and the body a timeout leaves
 * running then builds its client into the NEXT test's counter.
 */
import "../src/db/prisma";

/** One constructed client, with the URLs it was asked to connect to. */
interface BuiltClient {
  readonly sql: { readonly marker: "builder" };
  readonly urls: string[];
}

const built: BuiltClient[] = [];

vi.mock("@prisma/orm-postgres/serverless", () => ({
  default: () => {
    const client: BuiltClient = { sql: { marker: "builder" }, urls: [] };
    built.push(client);
    return {
      sql: client.sql,
      connect: ({ url }: { readonly url: string }) => {
        client.urls.push(url);
        return Promise.resolve({ query: () => Promise.resolve([]) });
      },
    };
  },
}));

/** The connection module under test, freshly instantiated for this test. */
async function connectionModule(): Promise<typeof import("../src/db/prisma")> {
  return await import("../src/db/prisma");
}

beforeEach(() => {
  vi.resetModules();
  built.length = 0;
});

describe("the catalog Prisma client is stateless and memoized (#1628)", () => {
  it("builds one client no matter how many callers ask for it", async () => {
    const { catalogClient } = await connectionModule();
    expect(catalogClient()).toBe(catalogClient());
    expect(built).toHaveLength(1);
  });

  it("does not build a second client when a request acquires a runtime", async () => {
    const { acquireCatalogRuntime, catalogClient } = await connectionModule();
    await catalogClient().connect({ url: "postgresql://first" });
    await acquireCatalogRuntime("postgresql://second");
    await acquireCatalogRuntime("postgresql://third");
    expect(built).toHaveLength(1);
  });

  it("hands each acquire its own runtime — one per request, keyed by that URL", async () => {
    const { acquireCatalogRuntime } = await connectionModule();
    const first = await acquireCatalogRuntime("postgresql://first");
    const second = await acquireCatalogRuntime("postgresql://second");
    expect(second).not.toBe(first);
    expect(built[0]?.urls).toEqual(["postgresql://first", "postgresql://second"]);
  });

  it("pairs a request's runtime with the SAME shared builder every time", async () => {
    const { acquireCatalogRuntime, catalogPrisma } = await connectionModule();
    const first = catalogPrisma(await acquireCatalogRuntime("postgresql://first"));
    const second = catalogPrisma(await acquireCatalogRuntime("postgresql://second"));
    expect(first.builder).toBe(second.builder);
    expect(first.executor).not.toBe(second.executor);
  });

  it("holds no connection on the built client: acquiring one is the only connect", async () => {
    const { acquireCatalogRuntime, catalogClient } = await connectionModule();
    catalogClient();
    catalogClient();
    expect(built).toHaveLength(1);
    expect(built[0]?.urls).toEqual([]);
    await acquireCatalogRuntime("postgresql://only");
    expect(built[0]?.urls).toEqual(["postgresql://only"]);
  });
});

/**
 * The ONE construction site (#1629).
 *
 * The shape above is memoized, so a second place that builds a client defeats it
 * silently — each site gets its own memo, and nothing in a runtime test notices
 * the duplicate. The tree is therefore read as text (the `?raw` glob technique
 * `dependency-rule.worker.test.ts` uses), and the serverless entry is allowed in
 * exactly one module.
 *
 * `test/` is out of scope by construction: the glob is rooted at `../src`.
 */
const CLIENT_FACTORY = "@prisma/orm-postgres/serverless";
const ONLY_CONSTRUCTION_SITE = "src/db/prisma.ts";

type TextTree = Readonly<Record<string, string>>;

const catalogSrc: TextTree = import.meta.glob<string>("../src/**/*.ts", {
  query: "?raw",
  eager: true,
  import: "default",
});

/** The `src/` modules in `tree` that name the client factory, as `src/…` paths. */
function constructionSites(tree: TextTree): string[] {
  return Object.entries(tree)
    .filter(([, source]) => source.includes(CLIENT_FACTORY))
    .map(([path]) => path.replace(/^\.\.\//, ""))
    .sort();
}

describe("the catalog client has ONE construction site (#1629)", () => {
  it("builds the client only in src/db/prisma.ts", () => {
    expect(constructionSites(catalogSrc)).toEqual([ONLY_CONSTRUCTION_SITE]);
  });

  it("goes red when a second module builds one", () => {
    const withSecondSite = {
      ...catalogSrc,
      "../src/adapters/outbound/second-site.ts": `import build from "${CLIENT_FACTORY}";\n`,
    };
    expect(constructionSites(withSecondSite)).toEqual([
      "src/adapters/outbound/second-site.ts", ONLY_CONSTRUCTION_SITE,
    ]);
  });
});
