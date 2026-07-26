import type { ChatDataPart } from "@seichijunrei/contract";
import type { ComponentType } from "react";
import { ClarifyCard, ProseCard, SearchCard } from "./components/cards";
import type { IntentCardProps } from "./components/cards";
import { RouteCard } from "./components/RouteCard";

/**
 * intent → card body. Later chat cards extend this map, not the renderer.
 * `error`/`unknown` envelopes are intercepted by the D-state classifier in
 * DataPartCard before this registry is consulted (issue #272 §D6), so their
 * entries are unreachable prose placeholders.
 */
export const intentRegistry: Record<ChatDataPart["intent"], ComponentType<IntentCardProps>> = {
  search_bangumi: SearchCard,
  search_nearby: SearchCard,
  plan_route: RouteCard,
  plan_selected: RouteCard,
  plan_multi: RouteCard,
  partial: RouteCard,
  clarify: ClarifyCard,
  general_qa: ProseCard,
  greet_user: ProseCard,
  blocked: ProseCard,
  error: ProseCard,
  unknown: ProseCard,
};
