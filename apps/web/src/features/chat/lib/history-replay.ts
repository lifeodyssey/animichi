import type { HistoryEntry } from "../use-conversation-history";
import type { ItineraryDraftPlan } from "./itinerary-draft";
import type { SelectedPlace } from "./selected-places";

/** Presentation data supplied by a future history adapter, not the current API payload. */
export type HistoryReplayBlock = Readonly<{ id: string }> & (
  | Readonly<{ kind: "scenes"; places: readonly SelectedPlace[] }>
  | Readonly<{ kind: "draft"; draft: ItineraryDraftPlan }>
  | Readonly<{ kind: "unavailable"; content: "scenes" | "draft" }>
);

/** Plain legacy entries remain valid; rich content is never inferred from text or intent. */
export interface HistoryReplayEntry extends HistoryEntry {
  readonly id?: string;
  readonly blocks?: readonly HistoryReplayBlock[];
}

export function hasUnavailableHistory(entries: readonly HistoryReplayEntry[]): boolean {
  return entries.some((entry) => entry.blocks?.some((block) => block.kind === "unavailable"));
}
