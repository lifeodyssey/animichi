/**
 * The `CaseLifecycle` that gives a case its starting point (E-1 #1380, spec §十
 * 10.1; 李博杰《深入理解 AI Agent》ch.7's `initialization_actions`).
 *
 * `Dataset.evaluate({ lifecycle })` runs `setup()` before the task, once per
 * case, which is the only moment a session can be prepared and still be the
 * session the measured turn runs on. Cases that carry no `seeded_pending` reach
 * no request at all — the five `phase1c_selection_v1` cases are the whole of
 * today's list, and `trajectory-prefix-case.ts` is what decides membership.
 *
 * A FAILED SEEDING FAILS THE CASE, LOUDLY. `logfire/evals` catches a throw from
 * `setup()` and records the case as a failure with the error on it, which is
 * the honest outcome: a selection case whose clarification was never seeded
 * measures a REFUSED pick (`SELECTION_EXPIRED`) and scores it as the agent's
 * answer. That is precisely the silent degradation this card exists to remove,
 * so a non-ok response must never be swallowed into a "just run it anyway".
 *
 * SO DOES AN UNREADABLE ONE. `trajectoryPrefixOf` answers `null` only for a
 * case that carries NO `seeded_pending` at all, and throws
 * `UnreadableSeededPendingError` for one it cannot read whole — because the two
 * are opposite facts that a single `null` would collapse into "run it
 * unseeded", which is the same degradation by another route.
 *
 * It is a CLASS FACTORY because the driver instantiates the class itself
 * (`new Lifecycle(case)`), leaving no constructor to inject a door into. The
 * closure is where the composition root's credentials stay — `src/` still makes
 * no request of its own and reads no environment.
 */
import { CaseLifecycle, type Case, type CaseLifecycleClass } from "logfire/evals";
import { stagingPrefixPathFor } from "@animichi/contract/staging-prefix-path";
import type { SeedTrajectoryPrefixRequest } from "@animichi/contract/staging-prefix-contract";

import type { ExportedAgentExpected, ExportedAgentInput } from "./dataset-roundtrip.ts";
import { SeededSessions } from "./seeded-sessions.ts";
import type { StagingBearer } from "./staging-bearer.ts";
import type { TurnDoor } from "./staging-turn-task.ts";
import { trajectoryPrefixOf } from "./trajectory-prefix-case.ts";

/** The seeding refused, or never landed. Carries the status and the body,
 * because the two refusals a runner must tell apart — an unowned session (404)
 * and a session that already has turns (409) — are different mistakes. */
export class PrefixSeedingFailure extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`the trajectory prefix was refused (status ${String(status)}): ${detail}`);
    this.name = "PrefixSeedingFailure";
    this.status = status;
  }
}

/** A case that needs a prefix but has no name has no idempotency key: the case
 * id IS the key the edge dedupes a re-seeding on. */
export class UnnamedPrefixCaseError extends Error {
  constructor() {
    super("a case carrying seeded_pending must have a name to seed a prefix under");
    this.name = "UnnamedPrefixCaseError";
  }
}

/** What the composition root supplies; `src/` never reads any of it itself. */
export interface PrefixSeedingSettings {
  readonly door: TurnDoor;
  readonly bearer: StagingBearer;
  /** Where a seeded session is recorded for the task that must run on it. */
  readonly sessions: SeededSessions;
  /** A fresh session id per case, injected so a test can make it deterministic
   * and a run cannot reuse one — a reused id is a session with turns in it,
   * which the edge refuses. */
  readonly sessionId: () => string;
}

type PrefixCase<Output> = Case<ExportedAgentInput, Output, ExportedAgentExpected>;

async function seedPrefix(
  settings: PrefixSeedingSettings, sessionId: string, request: SeedTrajectoryPrefixRequest,
): Promise<void> {
  const response = await settings.door(stagingPrefixPathFor(sessionId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await settings.bearer.current()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new PrefixSeedingFailure(response.status, await response.text());
}

/** The prefix this case needs, or null — refusing a nameless one out loud. */
function prefixFor<Output>(one: PrefixCase<Output>): SeedTrajectoryPrefixRequest | null {
  if (one.name !== undefined) return trajectoryPrefixOf(one.inputs, one.name);
  if (trajectoryPrefixOf(one.inputs, "unnamed") === null) return null;
  throw new UnnamedPrefixCaseError();
}

/**
 * The lifecycle class `Dataset.evaluate` instantiates per case.
 *
 * The session id is minted HERE rather than left to the edge, because the task
 * has to send its turns to the same one: `POST /v1/chat` mints a session when
 * the caller names none, and a prefix seeded into a session nobody then talks
 * in measures nothing.
 */
export function seededPrefixLifecycle<Output>(
  settings: PrefixSeedingSettings,
): CaseLifecycleClass<ExportedAgentInput, Output, ExportedAgentExpected> {
  return class SeededPrefixCase extends CaseLifecycle<ExportedAgentInput, Output, ExportedAgentExpected> {
    override async setup(): Promise<void> {
      const request = prefixFor(this.case);
      if (request === null) return;
      const sessionId = settings.sessionId();
      await seedPrefix(settings, sessionId, request);
      settings.sessions.claim(this.case.inputs, sessionId);
    }
  };
}
