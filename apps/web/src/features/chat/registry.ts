import type { ChatDataPart } from "@seichijunrei/contract";
import type { ComponentType } from "react";
import { ClarifyCard, ErrorCard, ProseCard, RouteCard, SearchCard } from "./components/cards";
import type { IntentCardProps } from "./components/cards";

/** intent → card body. Later chat cards extend this map, not the renderer. */
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
  error: ErrorCard,
  unknown: ProseCard,
};
