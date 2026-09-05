/**
 * The frozen prefix a `seeded_pending` eval case starts from (E-1 #1380),
 * built as the five `phase1c_selection_v1` cases carry it: an `anime_ambiguity`
 * question the previous turn's `resolve_anime` call could not settle.
 *
 * Named for what it constructs. Overrides name what a case is ABOUT.
 */
import type { PrefixSeedingRequest } from "../../src/agent/session/prefix-seeding.ts";
import type { TrajectoryPrefix } from "../../src/agent/session/trajectory-prefix.ts";

/** The clarification id `D3_multi_success_two` replies to. */
export const SEEDED_CLARIFICATION_ID = 7;

export function makeTrajectoryPrefix(overrides: Partial<TrajectoryPrefix> = {}): TrajectoryPrefix {
  return {
    caseId: "phase1c_selection_v1/D3_multi_success_two",
    userText: "響け！ユーフォニアム の聖地に行きたい",
    toolCall: {
      toolName: "resolve_anime",
      params: { title: "響け！ユーフォニアム" },
      resultText: '{"status":"ambiguous","candidates":[{"id":"115908"},{"id":"11291"}]}',
      resultDetails: { status: "ambiguous" },
    },
    assistantText: "どちらの作品ですか？",
    pendingClarification: {
      id: SEEDED_CLARIFICATION_ID,
      reason: "anime_ambiguity",
      candidates: [
        { id: "115908", title: "Sound Euphonium" },
        { id: "11291", title: "Haruhi Suzumiya" },
      ],
    },
    currentAnime: null,
    ...overrides,
  };
}

/** The identity the eval's QA user signs in as. */
export const SEEDING_IDENTITY = "qa-neon-user";

/** One seeding request on a session that identity owns. */
export function makePrefixSeedingRequest(
  overrides: Partial<PrefixSeedingRequest> = {},
): PrefixSeedingRequest {
  return {
    sessionId: "session-prefix-1",
    identityId: SEEDING_IDENTITY,
    payer: "user",
    prefix: makeTrajectoryPrefix(),
    ...overrides,
  };
}

/** The body a harness posts, as `trajectoryPrefixIn` receives it. */
export function makePrefixBody(prefix: TrajectoryPrefix = makeTrajectoryPrefix()): unknown {
  return {
    case_id: prefix.caseId,
    user_text: prefix.userText,
    tool_call: {
      tool_name: prefix.toolCall.toolName,
      params: JSON.stringify(prefix.toolCall.params),
      result_text: prefix.toolCall.resultText,
      result_details: JSON.stringify(prefix.toolCall.resultDetails),
    },
    assistant_text: prefix.assistantText,
    pending_clarification: prefix.pendingClarification === null ? null : {
      id: prefix.pendingClarification.id,
      reason: prefix.pendingClarification.reason,
      candidates: prefix.pendingClarification.candidates,
    },
    current_anime: prefix.currentAnime === null ? null : {
      bangumi_id: prefix.currentAnime.bangumiId,
      title: prefix.currentAnime.title,
    },
  };
}
