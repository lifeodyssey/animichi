import { SessionAgent } from "../src/agent/host/session-agent.ts";

/**
 * The production host for a probe that binds its own native session and no real business database, at most a
 * stand-in the turn budget writes its deadline refusal to. Domain startup is the probe's `initializeSession`, and
 * a wake drives the lane's current unsettled operation: such a probe has no admissions, selections or settlements
 * for the deployed wake to scan. The interval schedule calls `wakeSession` by name, so every probe extends this,
 * including those that never call it.
 */
export abstract class NativeOnlyHost extends SessionAgent {
  override async wakeSession(): Promise<void> {
    await this.withSession(async (_session, lane, context) => {
      const current = (await lane.inspectExecution(context)).current;
      if (current && !await lane.getResult(current.id, context)) await this.driveLane(lane, current.id, context);
    });
  }
}
