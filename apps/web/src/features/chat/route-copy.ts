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
/**
 * Truncate to at most `max` UTF-16 units (the bound `SaveRouteInput.title`
 * enforces) without splitting a grapheme cluster — a naive `slice` can leave a
 * lone surrogate half, and stream-supplied work titles carry emoji and combining
 * marks.
 */
function truncateGraphemes(value: string, max: number): string {
  if (value.length <= max) return value;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let out = "";
  for (const { segment } of segmenter.segment(value)) {
    if (out.length + segment.length > max) break;
    out += segment;
  }
  return out;
}

/** `SaveRouteInput.title` is required and 1-200 chars, and nothing in the chat
 * flow produces one — so the client derives it from the resolved work title
 * plus the stop count through a localized template (issue #273 S1.7, P2-4).
 * An absent work title uses the locale's own stand-in, never an English one.
 * The replacements use replacer *functions*: a work title containing `$&` or
 * `$1` would otherwise be expanded as a replacement pattern. */
export function saveRouteTitle(dict: ChatDict, workTitle: string | undefined, spots: number): string {
  const work = workTitle === undefined || workTitle === "" ? dict.route.saveUntitled : workTitle;
  const rendered = dict.route.saveTitle
    .replace("{title}", () => work)
    .replace("{count}", () => String(spots));
  return truncateGraphemes(rendered, 200);
}

export function routeStatsCopy(dict: ChatDict, spots: number, minutes: number | undefined): string {
  return dict.route.stats
    .replace("{spots}", String(spots))
    .replace("{min}", minutes === undefined ? "—" : String(minutes));
}
