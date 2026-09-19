import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allowsInlineScript, contentOf, inlineScriptTagsOf, nonceOf } from "../csp-evaluator";

/**
 * Boot the artifact main CD actually promotes, and ask it for a page.
 *
 * CD ships Nitro's prebuilt chunks with `wrangler deploy --no-bundle`, so no
 * esbuild pass rewrites them on the way out. Nothing else in this package's
 * gates ever evaluates those chunks: unit tests import source modules with the
 * SDK mocked, and the other integration cases only dry-run the upload and read
 * the emitted files. That blind spot shipped a Worker which answered 500 to
 * every request — `@neondatabase/auth` calls `crypto.randomUUID()` at module
 * scope, and workerd evaluates module top level outside an I/O context — while
 * every gate stayed green. Only a real boot catches that class of failure.
 *
 * The security-policy cases below are here for the same reason, and only here:
 * the unit suite pins the policy text and the middleware in isolation, but the
 * two things that actually broke while #469 was being written are both visible
 * only from a real response — that the framework's render and the middleware's
 * header agree on one nonce, and that they agree on every status code (h3 v2
 * keeps an event's prepared headers only for an `ok` Response, so a
 * `setResponseHeader` design published no policy at all on the branded 404).
 * One boot serves both concerns; a second `wrangler dev` in this suite
 * contends with this one and flakes.
 */

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const nodeRequire = createRequire(import.meta.url);
/** Resolved, never taken from PATH, and run with this interpreter rather than a shebang. */
const WRANGLER_BIN = join(dirname(nodeRequire.resolve("wrangler/package.json")), "bin", "wrangler.js");
const PORT = 8797;
const ORIGIN = `http://127.0.0.1:${String(PORT)}`;
const BOOT_TIMEOUT_MS = 120_000;
const READY_MARKER = "Ready on";

let worker: ChildProcess | undefined;
let log = "";

function bootPromotedWorker(): ChildProcess {
  const args = [WRANGLER_BIN, "dev", "--no-bundle", "--local", "--ip", "127.0.0.1", "--port", String(PORT)];
  const child = spawn(process.execPath, args, { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"] });
  const collect = (chunk: Buffer): void => { log += String(chunk); };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  // A spawn that never starts emits `error` and no output at all, which would
  // otherwise read as "still booting" for the whole timeout.
  child.on("error", (error: Error) => { log += `spawn failed: ${error.message}\n`; });
  return child;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A signal kill leaves `exitCode` null, so reading it alone waits out the timeout. */
function bootFailure(child: ChildProcess): string | undefined {
  if (child.signalCode !== null) return `wrangler dev was killed by ${child.signalCode}`;
  if (child.exitCode !== null) return `wrangler dev exited (${String(child.exitCode)})`;
  return undefined;
}

/** Wrangler announces its port once workerd holds the Worker; poll the log, not the socket. */
async function waitForReady(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const failure = bootFailure(child);
    if (failure !== undefined) throw new Error(`startup smoke: ${failure}\n${log}`);
    if (log.includes(READY_MARKER)) return;
    await sleep(250);
  }
  throw new Error(`startup smoke: never became ready within ${String(BOOT_TIMEOUT_MS)}ms\n${log}`);
}

beforeAll(async () => {
  worker = bootPromotedWorker();
  await waitForReady(worker);
}, BOOT_TIMEOUT_MS + 10_000);

afterAll(() => {
  worker?.kill("SIGTERM");
});

interface Served {
  readonly status: number;
  readonly policy: string;
  readonly html: string;
}

async function fetchDocument(path: string): Promise<Served> {
  const response = await fetch(`${ORIGIN}${path}`, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(30_000) });
  return { status: response.status, policy: response.headers.get("Content-Security-Policy") ?? "", html: await response.text() };
}

function nonceIn(policy: string): string | undefined {
  return /'nonce-([A-Za-z0-9_-]+)'/u.exec(policy)?.[1];
}

describe("promoted Worker startup", () => {
  it("server-renders the doorway instead of an error envelope", async () => {
    const { status, html } = await fetchDocument("/");

    // The Worker's own log carries the cause; Nitro redacts it out of the body,
    // so a bare `expected 500 to be 200` would send the reader hunting for it.
    expect(status, log).toBe(200);
    // `<main>` only exists once the route tree rendered on the server: a Worker
    // that boots but cannot run a route still answers with Nitro's JSON shell.
    expect(html, log).toContain("<main");
  });
});

describe("the policy the promoted Worker serves (issue #469)", () => {
  it.each([["/", 200], ["/chat", 200], ["/no-such-route-469", 404]])(
    "covers %s (status %i), with every inline script carrying the header's nonce",
    async (path, status) => {
      const { status: actual, policy, html } = await fetchDocument(path);
      expect(actual, log).toBe(status);
      const nonce = nonceIn(policy);
      expect(nonce, policy).toBeDefined();

      const tags = inlineScriptTagsOf(html);
      expect(tags.length, "the document should still emit its bootstrap").toBeGreaterThan(3);
      for (const tag of tags) expect(nonceOf(tag), tag.slice(0, 120)).toBe(nonce);
    },
  );

  it("refuses an inline script the app did not emit, and allows the ones it did", async () => {
    const { policy, html } = await fetchDocument("/");
    const attacker = { content: "fetch('/steal?k='+sessionStorage.getItem('byok-api-key'))" };
    expect(allowsInlineScript(policy, attacker)).toBe(false);

    // The document's own first script: allowed with the nonce, refused without.
    const [firstTag] = inlineScriptTagsOf(html);
    if (firstTag === undefined) throw new Error(`the document emitted no inline script\n${html.slice(0, 400)}`);
    const content = contentOf(firstTag);
    expect(allowsInlineScript(policy, { nonce: nonceIn(policy), content })).toBe(true);
    expect(allowsInlineScript(policy, { content })).toBe(false);
  });
});
