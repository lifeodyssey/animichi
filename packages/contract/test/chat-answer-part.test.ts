/**
 * The conformance half of the `data-response` seam (#1283).
 *
 * `workers/edge` builds the part and cannot load zod to check it — that is the
 * whole point of the generated module next door. So the check runs HERE, where
 * zod lives, against the edge's own projection: `turn-answer-part.ts` has no
 * runtime import at all, so importing it costs this package nothing and leaves
 * no second copy of the shape to drift.
 */
import { describe, expect, it } from "vitest";
import type { Point, TimedItinerary } from "../src/models.js";
import { ChatResponseDataPart } from "../src/chat-data-parts.js";
import { CHAT_RESPONSE_INTENTS } from "../src/agent-tool-schemas.js";
import { chatResponsePart } from "../../../workers/edge/src/agent/session/turn-answer-part.ts";
import type { TurnAnswer } from "../../../workers/edge/src/agent/session/turn-answer.ts";

const POINT: Point = {
  id: "spot-1",
  name: "鷲宮神社",
  bangumi_id: "1",
  episode: 3,
  screenshot_url: "https://image.anitabi.cn/p1.jpg",
  latitude: 36.1019,
  longitude: 139.6586,
  title: "らき☆すた",
};

const TIMED: TimedItinerary = { stops: [], legs: [], total_minutes: 120, total_distance_m: 4200 };

const MESSAGE = "聖地巡礼の答え";
const PROSE: TurnAnswer = { of: "prose", intent: "general_qa", message: MESSAGE };

const searchAnswer = (
  intent: "search_bangumi" | "search_nearby",
  kind: "bangumi" | "nearby",
): TurnAnswer => ({
  of: "search",
  intent,
  message: MESSAGE,
  search: {
    kind,
    rows: [POINT],
    row_count: 1,
    metadata: { anime_title: "らき☆すた", data_origin: "catalog", source: "catalog" },
    anime_id: "1",
    partial: false,
  },
});

const ITINERARY = {
  ordered_points: [POINT],
  timed_itinerary: TIMED,
  summary: {
    point_count: 1,
    total_minutes: 120,
    total_distance_m: 4200,
    clusters: 1,
    with_coordinates: 1,
    without_coordinates: 0,
  },
  source_ref: "search:1:1",
};

const ROUTE: TurnAnswer = { of: "route", intent: "plan_route", message: MESSAGE, itinerary: ITINERARY };

const CLARIFY: TurnAnswer = {
  of: "clarification",
  intent: "clarify",
  message: MESSAGE,
  clarification: {
    id: 3,
    reason: "anime_ambiguity",
    candidates: [{ id: "1", title: "らき☆すた", effective_radius_m: 5_000 }],
  },
};

/** The four deterministic-selection answers (#1288). Each carries its own
 * `status`/`success` rather than deriving them, so the envelope the contract
 * sees on this path is built here and nowhere else. */
const SELECTED: TurnAnswer = {
  of: "selected",
  intent: "plan_selected",
  message: MESSAGE,
  itinerary: ITINERARY,
  status: "ok",
  success: true,
};

const MULTI: TurnAnswer = {
  of: "multi",
  intent: "plan_multi",
  message: MESSAGE,
  search: { kind: "multi", rows: [POINT], row_count: 1, metadata: null, anime_id: null, partial: false },
  itinerary: ITINERARY,
  status: "ok",
  success: true,
};

const PLACE: TurnAnswer = {
  of: "place",
  intent: "search_nearby",
  message: MESSAGE,
  search: { kind: "nearby", rows: [], row_count: 0, metadata: null, anime_id: null, partial: false },
  status: "empty",
  success: true,
};

const REFUSED: TurnAnswer = {
  of: "refused",
  intent: "clarify",
  message: "This choice expired; please try again.",
  status: "invalid_request",
  success: false,
};

const ANSWERS: TurnAnswer[] = [
  searchAnswer("search_bangumi", "bangumi"),
  searchAnswer("search_nearby", "nearby"),
  ROUTE,
  CLARIFY,
  PROSE,
  { of: "prose", intent: "greet_user", message: MESSAGE },
  SELECTED,
  MULTI,
  PLACE,
  REFUSED,
];

describe("the edge's data-response part", () => {
  it.each(ANSWERS)("validates against the contract for intent $intent", (answer) => {
    expect(() => ChatResponseDataPart.parse(chatResponsePart(answer))).not.toThrow();
  });

  it("publishes an intent the contract's own union declares", () => {
    const intents = ANSWERS.map((answer) => chatResponsePart(answer).intent);
    expect(CHAT_RESPONSE_INTENTS).toEqual(expect.arrayContaining(intents));
  });

  it("strips the candidate fields only the tools use, and publishes the question's own id", () => {
    const parsed = ChatResponseDataPart.parse(chatResponsePart(CLARIFY));
    expect(parsed.data).toEqual({
      reason: "anime_ambiguity",
      clarification_id: 3,
      candidates: [{ id: "1", title: "らき☆すた" }],
    });
  });

  it("publishes both halves of a merged pick, and neither for a refused one", () => {
    const merged = ChatResponseDataPart.parse(chatResponsePart(MULTI));
    expect(Object.keys(merged.data ?? {})).toEqual(["results", "itinerary"]);
    const refused = ChatResponseDataPart.parse(chatResponsePart(REFUSED));
    expect(refused.errors).toEqual([
      { code: "invalid_selection", message: "This choice expired; please try again.", details: {} },
    ]);
  });

  it("keeps the itinerary's own members and drops the ref only the model used", () => {
    const parsed = ChatResponseDataPart.parse(chatResponsePart(ROUTE));
    expect(Object.keys(parsed.data ?? {})).toEqual(["itinerary"]);
    expect(chatResponsePart(ROUTE).data).not.toHaveProperty("itinerary.source_ref");
  });
});
