import type { SessionMetadata, SessionRepo } from "@earendil-works/pi-agent-core/harness/session";
import type { AdmissionDatabase } from "../src/agent/admission/types.ts";
import { SessionAgent } from "../src/agent/host/session-agent.ts";
import type { Composition, ModelOperations } from "../src/agent/host/session-domain.ts";

/** Where a probe's turn budget records a spent deadline unless the probe supplies its own: the write is
 * refused, as a lost lock would refuse it, and the turn still aborts. */
const REFUSING_BUSINESS = { transaction: () => Promise.resolve(false) } as unknown as AdmissionDatabase;

function noModelOperation(): never {
  throw new Error("A probe accepts and drives its lane itself; it runs no model operation through the agent");
}

/** A probe never submits, watches or recovers through the business paths, so none of these is reached. */
const NO_MODEL_OPERATIONS: ModelOperations = {
  admit: noModelOperation, replayRequest: noModelOperation, prepareDrive: noModelOperation,
  driveContext: noModelOperation, scrub: noModelOperation, release: noModelOperation,
};

/**
 * The production host for a probe that binds its own native session and no real business database: a stand-in
 * the turn budget writes a spent deadline's refusal to. Domain startup is the probe's `initializeSession`, which
 * binds through `bindProbeSession`, and a wake drives the lane's current unsettled operation, since such a probe
 * has no admissions, selections or settlements for the deployed wake to scan. The interval schedule calls
 * `wakeSession` by name, so every probe extends this, including those that never call it.
 */
export abstract class NativeOnlyHost extends SessionAgent {
  /** Bind a probe's own session; `business` is where its turn budget records a spent deadline. */
  protected bindProbeSession(repo: SessionRepo, metadata: SessionMetadata, compose: Composition, business = REFUSING_BUSINESS) {
    this.bindSession({ repo, metadata, compose, business, operations: NO_MODEL_OPERATIONS });
  }

  override async wakeSession(): Promise<void> {
    await this.withSession(async (_session, lane, context) => {
      const current = (await lane.inspectExecution(context)).current;
      if (current && !await lane.getResult(current.id, context)) await this.driveLane(lane, current.id, context);
    });
  }
}
