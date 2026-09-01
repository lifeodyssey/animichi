/**
 * Widens `RuntimeContainer#startAndWaitForPorts`'s wait for the app to start
 * listening on its port (issue #1220 follow-up, 2026-09-01 staging
 * reproduction).
 *
 * Split out of `entry.ts` for the same reason as `container-env.ts`
 * alongside it: `entry.ts` imports `Container` from `@cloudflare/containers`,
 * whose ESM build only resolves under workerd's module loader, not Node's —
 * a test importing straight from `entry.ts` fails with `ERR_MODULE_NOT_FOUND`
 * outside `wrangler dev`/deploy. The `import type` below is erased before
 * that resolution would ever happen, so this module stays plain
 * `node --test`-safe while still typing against the library's real shapes.
 *
 * `CancellationOptions`/`StartAndWaitForPortsOptions` aren't re-exported from
 * the package's public barrel (only from its internal `types` module), so
 * these are derived structurally off `Container["startAndWaitForPorts"]`
 * instead of imported by name.
 */
import type { Container } from "@cloudflare/containers";

/**
 * Measured container cold start on staging is >35s (2026-09-01
 * reproduction); the library default (`TIMEOUT_TO_GET_PORTS_MS` in
 * `@cloudflare/containers@0.3.7`'s `dist/lib/container.js`) is 20s, so the
 * first request after the 10-minute `sleepAfter` idle window deterministically
 * got a 500 "not listening" before the app finished starting. 55s stays
 * inside `CONTAINER_FETCH_HEAD_TIMEOUT_MS` (60s, `gateway/container-fetch.ts`)
 * so a `/v1` forward's head timeout still bounds the worst case.
 */
export const CONTAINER_PORT_READY_TIMEOUT_MS = 55_000;

type StartAndWaitForPortsArgs = Parameters<Container["startAndWaitForPorts"]>;
type PortsOrOptions = NonNullable<StartAndWaitForPortsArgs[0]>;
type CancellationOptions = NonNullable<StartAndWaitForPortsArgs[1]>;
type OptionsObject = Exclude<PortsOrOptions, number | number[]>;

function isOptionsObject(value: PortsOrOptions | undefined): value is OptionsObject {
  return typeof value === "object" && !Array.isArray(value);
}

function withBudget(options: CancellationOptions | undefined): CancellationOptions {
  return { ...options, portReadyTimeoutMS: options?.portReadyTimeoutMS ?? CONTAINER_PORT_READY_TIMEOUT_MS };
}

/** Merges the port-ready budget into either call shape `containerFetch` may
 * use — positional `(ports?, cancellationOptions?, startOptions?)` or object
 * `({ ports?, cancellationOptions?, startOptions? })` — preserving any
 * caller-supplied `abort` (and any other option) and never overriding an
 * explicit caller `portReadyTimeoutMS`. */
export function withPortReadyBudget(args: StartAndWaitForPortsArgs): StartAndWaitForPortsArgs {
  const [portsOrArgs, cancellationOptions, startOptions] = args;
  if (isOptionsObject(portsOrArgs)) {
    return [{ ...portsOrArgs, cancellationOptions: withBudget(portsOrArgs.cancellationOptions) }, cancellationOptions, startOptions];
  }
  return [portsOrArgs, withBudget(cancellationOptions), startOptions];
}
