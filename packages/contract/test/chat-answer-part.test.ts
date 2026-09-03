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

const PROSE: TurnAnswer = {
  intent: "general_qa",
  message: "聖地巡礼の答え",
  payload: { of: "prose" },
};

const searchAnswer = (intent: TurnAnswer["intent"], kind: "bangumi" | "nearby"): TurnAnswer => ({
  ...PROSE,
  intent,
  payload: {
    of: "search",
    search: {
      kind,
      rows: [POINT],
      row_count: 1,
      metadata: { anime_title: "らき☆すた", data_origin: "catalog", source: "catalog" },
      anime_id: "1",
      partial: false,
    },
  },
});

const ROUTE: TurnAnswer = {
  ...PROSE,
  intent: "plan_route",
  payload: {
    of: "route",
    itinerary: {
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
    },
  },
};

const CLARIFY: TurnAnswer = {
  ...PROSE,
  intent: "clarify",
  payload: {
    of: "clarification",
    clarification: {
      reason: "anime_ambiguity",
      candidates: [{ id: "1", title: "らき☆すた", effective_radius_m: 5_000 }],
    },
  },
};

const ANSWERS: TurnAnswer[] = [
  searchAnswer("search_bangumi", "bangumi"),
  searchAnswer("search_nearby", "nearby"),
  ROUTE,
  CLARIFY,
  PROSE,
  { ...PROSE, intent: "greet_user" },
];

describe("the edge's data-response part", () => {
  it.each(ANSWERS)("validates against the contract for intent $intent", (answer) => {
    expect(() => ChatResponseDataPart.parse(chatResponsePart(answer))).not.toThrow();
  });

  it("publishes an intent the contract's own union declares", () => {
    const intents = ANSWERS.map((answer) => chatResponsePart(answer).intent);
    expect(CHAT_RESPONSE_INTENTS).toEqual(expect.arrayContaining(intents));
  });

  it("strips the candidate fields only the tools use, as Python's filter did", () => {
    const parsed = ChatResponseDataPart.parse(chatResponsePart(CLARIFY));
    expect(parsed.data).toEqual({ reason: "anime_ambiguity", candidates: [{ id: "1", title: "らき☆すた" }] });
  });

  it("keeps the itinerary's own members and drops the ref only the model used", () => {
    const parsed = ChatResponseDataPart.parse(chatResponsePart(ROUTE));
    expect(Object.keys(parsed.data ?? {})).toEqual(["itinerary"]);
    expect(chatResponsePart(ROUTE).data).not.toHaveProperty("itinerary.source_ref");
  });
});
