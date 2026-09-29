/**
 * The Worker that drives `MigratorApplyLock` directly (#1868).
 *
 * `POST /?apply=a@400&apply=b@0` issues one `migrate` RPC per `apply`, in that order, on the
 * one fixed-name stub — the production hop of `src/lock.ts`, minus the Hono routing that would
 * answer 409 before the object was ever reached. It reports the order the applies actually
 * crossed the gate, how long the whole set took, and each RPC's outcome or thrown message.
 *
 * `recorded-apply.ts`'s module state is readable here because local workerd runs a script's
 * actor and its entrypoint in one isolate (verified before this file was written). Only the
 * instrumentation leans on that; what is asserted is the gate's own behaviour.
 */
import { MigratorApplyLock } from "../src/apply-lock";
import { APPLY_LOCK_NAME } from "../src/lock";
import type { SelectedMetadata, SelectedMigration } from "../src/selected-migration";
import { applyCrossings, forgetApplyCrossings } from "./recorded-apply";
import { SERVICE_ROLE_PASSWORDS } from "./service-role-passwords";

export { MigratorApplyLock };

interface ApplyLockEnv {
  MIGRATOR_APPLY_LOCK: DurableObjectNamespace;
}

interface ApplyStub {
  migrate(dsn: string, passwords: unknown, metadata: SelectedMetadata): Promise<SelectedMigration>;
}

/** Whatever the RPC did — an outcome, or the message the platform ended it with. */
export type ApplyReport =
  | { readonly settled: true; readonly outcome: SelectedMigration }
  | { readonly settled: false; readonly message: string };

export interface ApplyRunReport {
  readonly crossings: readonly string[];
  readonly elapsedMs: number;
  readonly applies: readonly ApplyReport[];
}

function report(error: unknown): ApplyReport {
  return { settled: false, message: error instanceof Error ? error.message : String(error) };
}

function fixedStub(env: ApplyLockEnv): ApplyStub {
  return env.MIGRATOR_APPLY_LOCK.get(env.MIGRATOR_APPLY_LOCK.idFromName(APPLY_LOCK_NAME)) as unknown as ApplyStub;
}

const METADATA: SelectedMetadata = { expectedPrismaRef: "0".repeat(64) };

async function runApplies(request: Request, env: ApplyLockEnv): Promise<Response> {
  const specs = new URL(request.url).searchParams.getAll("apply");
  const stub = fixedStub(env);
  forgetApplyCrossings();
  const startedAt = Date.now();
  const issued = specs.map((spec) => stub.migrate(spec, SERVICE_ROLE_PASSWORDS, METADATA)
    .then((outcome): ApplyReport => ({ settled: true, outcome }), report));
  const applies = await Promise.all(issued);
  return Response.json({ crossings: applyCrossings(), elapsedMs: Date.now() - startedAt, applies } satisfies ApplyRunReport);
}

export default { fetch: runApplies };
