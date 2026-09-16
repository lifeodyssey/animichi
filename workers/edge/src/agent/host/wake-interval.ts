/**
 * The recurring recovery cadence of the native session host.
 *
 * One interval schedule calls `wakeSession`, which rediscovers accepted, unsettled and
 * selection work so a session recovers without another client request. The 30 s value came
 * in with `b6cf74034 refactor(agent): switch to native pi runtime` and that commit gives no
 * reason for it. #1731 added the seam: `SessionAgent.wakeIntervalMs`, so a database-backed
 * test lane arms its own faster cadence instead of waiting out production's half minute.
 */
export const WAKE_INTERVAL_MS = 30_000;
