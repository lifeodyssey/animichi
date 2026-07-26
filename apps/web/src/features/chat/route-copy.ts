import type { ItineraryLeg } from "../../lib/chat/itinerary";
import type { ChatDict } from "./i18n";

/** Localized capsule copy for a between-station leg (issue #271 S1.5). */
export function legCapsule(dict: ChatDict, leg: ItineraryLeg): string {
  const template = leg.mode === "walk" ? dict.route.walkCapsule : dict.route.transitCapsule;
  return template.replace("{min}", String(leg.minutes));
}

/** Localized headline stats for the route card (issue #271 S1.5). Absent
 * walking minutes render as an em dash rather than a bare "?" so the line
 * reads as copy in every locale. */
export function routeStatsCopy(dict: ChatDict, spots: number, minutes: number | undefined): string {
  return dict.route.stats
    .replace("{spots}", String(spots))
    .replace("{min}", minutes === undefined ? "—" : String(minutes));
}
