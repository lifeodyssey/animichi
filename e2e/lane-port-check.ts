/**
 * The emitted-Worker lane's up-front port claim (#1692).
 *
 * `webServer.command` runs this first, before the build and before any spec:
 *
 *     node lane-port-check.ts <port>
 *
 * Killing `wrangler` orphans its `workerd` child, which keeps the port bound.
 * The lane that starts next then loses its server mid-run and fails with
 * Chromium's `ERR_CONNECTION_REFUSED` raised inside a test body, naming neither
 * the port nor the process holding it — which is exactly the failure #1692
 * exists to remove. This refuses that lane while it is still a startup step,
 * naming both, and never suggests `reuseExistingServer: true` as the remedy:
 * attaching to another checkout's server IS the bug.
 *
 * Deliberately free of `import`/`export` statements: `e2e/` is a CommonJS
 * package scope (Playwright `require`s `playwright.config.ts`), so static ESM
 * syntax here would make Node reparse this file as a module and print a
 * typeless-package warning into the lane's own server log. The builtins come in
 * through `import()`, which is legal in both modes.
 */
const PROBE_HOSTS = ["127.0.0.1", "::1"] as const;
const DIGITS = /^[0-9]+$/;

async function main(): Promise<void> {
  const port = portFrom(process.argv[2]);
  const holders = await holdersOn(port);
  if (holders.length === 0 && !(await anyHostAccepts(port))) {
    console.log(`emitted-Worker lane port ${String(port)} is free`);
    return;
  }
  console.error(refusal(port, holders));
  process.exitCode = 1;
}

/** The port argument, refused rather than defaulted when it is unusable: this
 *  step exists to make a port problem explicit. */
function portFrom(raw: string | undefined): number {
  const text = (raw ?? "").trim();
  if (!DIGITS.test(text)) throw new Error("usage: node lane-port-check.ts <port>");
  return Number(text);
}

/** Whoever is LISTENING on the port, as text that names a process. Reading the
 *  holder is best-effort (`lsof` is absent on some runners, and answers with
 *  nothing when the socket is held by another user); whether the port is taken
 *  is decided by the connection probe below, not by this. */
async function holdersOn(port: number): Promise<readonly string[]> {
  const { execFileSync } = await import("node:child_process");
  function capture(command: string, args: readonly string[]): string {
    try {
      return execFileSync(command, args, { encoding: "utf8" });
    } catch {
      return "";
    }
  }
  const listing = capture("lsof", ["-nP", `-iTCP:${String(port)}`, "-sTCP:LISTEN", "-t"]);
  return listing.split("\n").flatMap((line) => (DIGITS.test(line.trim()) ? [holder(capture, line.trim())] : []));
}

function holder(capture: (command: string, args: readonly string[]) => string, pid: string): string {
  const command = capture("ps", ["-o", "comm=", "-p", pid]).trim();
  return `${command === "" ? "an unidentifiable process" : command} (pid ${pid})`;
}

/** A listener answers on the port it bound, and 127.0.0.1 and ::1 are separate
 *  binds — the same both-families rule Playwright's own readiness probe uses. */
async function anyHostAccepts(port: number): Promise<boolean> {
  const answers = await Promise.all(PROBE_HOSTS.map((host) => accepts(port, host)));
  return answers.includes(true);
}

async function accepts(port: number, host: string): Promise<boolean> {
  const { connect } = await import("node:net");
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

function refusal(port: number, holders: readonly string[]): string {
  return [
    `the emitted-Worker lane cannot bind port ${String(port)}: ${occupiedBy(holders)}.`,
    "This is the stranded-listener hazard (#1692) — killing `wrangler` leaves its `workerd` child on the port,",
    "and the lane that starts next loses its server mid-run to Chromium's ERR_CONNECTION_REFUSED.",
    "Free the port, or run this lane on another one with E2E_EMITTED_WORKER_PORT=<port>.",
    "Do NOT set `reuseExistingServer`: attaching to another checkout's server is the bug, not the cure.",
  ].join("\n");
}

function occupiedBy(holders: readonly string[]): string {
  return holders.length === 0
    ? "an unidentified process is already listening there"
    : `${holders.join(", ")} is already listening there`;
}

void main();
