import type { ItineraryLeg } from "../../lib/chat/itinerary";
import type { ChatDict } from "./i18n";

/** Localized capsule copy for a between-station leg (issue #271 S1.5). */
export function legCapsule(dict: ChatDict, leg: ItineraryLeg): string {
  const template = leg.mode === "walk" ? dict.route.walkCapsule : dict.route.transitCapsule;
  return template.replace("{min}", String(leg.minutes));
}
