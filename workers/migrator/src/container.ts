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
 */
export class MigrationContainer extends Container {
  requiredPorts: number[] = [];
  enableInternet = true;
}
