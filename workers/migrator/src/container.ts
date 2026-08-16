import { Container } from "@cloudflare/containers";

/**
 * #1051 — the worker's one-shot Atlas migration batch container (Cloudflare
 * batch-job container mode). A pure batch job: it listens for no port and its
 * main process runs the pinned Atlas apply (see docker/Dockerfile +
 * docker/entrypoint.sh) then exits — the container moves to
 * `stopped_with_code` with the exit code. The DSN is injected as
 * `MIGRATOR_DATABASE_URL` (src/runner.ts) at start time only, so it never
 * lives in a standing binding.
 *
 * This class references the platform @cloudflare/containers runtime, so it is
 * loaded only by the deployed entry (src/index.ts) and never by the plain node
 * vitest HTTP-seam suite. The runner's exit/timeout logic is unit-tested in
 * src/runner.ts against a narrow handle seam.
 *
 * #1093: requiredPorts is deliberately NOT overridden (no '= []'). With an
 * empty array, @cloudflare/containers@0.3.7's start() resolves portToCheck to
 * 'requiredPorts[0]' = undefined and the platform's getTcpPort(undefined)
 * throws 'Invalid port number: 0' (surfaced via #1091). Leaving the field at
 * the library default falls back to FALLBACK_PORT_TO_CHECK (33); the
 * healthcheck ping to an unlistening port is tolerated for running containers
 * ('isNotListeningError && container.running'), so the batch job starts.
 */
export class MigrationContainer extends Container {
  enableInternet = true;
  /** #1101: strictly longer than CONTAINER_TIMEOUT_MS (10m) so a genuinely
   * long apply is not frozen by the platform activity timer mid-flight. */
  sleepAfter = "30m";
}
