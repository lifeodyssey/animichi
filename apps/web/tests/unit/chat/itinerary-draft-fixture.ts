import type { ItineraryDraftPlan } from "../../../src/features/chat/lib/itinerary-draft";

export const draftFixture = {
  id: "draft-a", title: "东京半日巡礼", conditions: { origin: "四谷站", availableTime: "半天", departureTime: "" },
  introduction: "按这两处地点安排一版。", assumptions: [], stops: [
    { place: { id: "suga", name: "須賀神社 男坂", viewpoints: [
      { id: "steps", frames: [{ id: "a", url: "/images/compare/anime.jpg" }, { id: "b", url: "/images/compare/real.jpg" }] },
      { id: "second", name: "另一处已有名称", frames: [{ id: "c", url: "/images/compare/real.jpg" }] },
    ] }, suggestion: "留时间看看选中的画面。", stayEstimate: { minMinutes: 20, maxMinutes: 40 } },
    { place: { id: "crossing", name: "参宮橋 1号踏切", viewpoints: [{ id: "railway", frames: [{ id: "d", url: "/images/compare/anime.jpg" }] }] } },
  ],
} as const satisfies ItineraryDraftPlan;
