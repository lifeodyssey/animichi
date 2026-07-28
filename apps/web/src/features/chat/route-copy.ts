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
/** `SaveRouteInput.title` is required and 1-200 chars, and nothing in the chat
 * flow produces one — so the client derives it from the resolved work title
 * plus the stop count through a localized template (issue #273 S1.7, P2-4).
 * An absent work title uses the locale's own stand-in, never an English one. */
export function saveRouteTitle(dict: ChatDict, workTitle: string | undefined, spots: number): string {
  const work = workTitle === undefined || workTitle === "" ? dict.route.saveUntitled : workTitle;
  return dict.route.saveTitle
    .replace("{title}", work)
    .replace("{count}", String(spots))
    .slice(0, 200);
}

export function routeStatsCopy(dict: ChatDict, spots: number, minutes: number | undefined): string {
  return dict.route.stats
    .replace("{spots}", String(spots))
    .replace("{min}", minutes === undefined ? "—" : String(minutes));
}
