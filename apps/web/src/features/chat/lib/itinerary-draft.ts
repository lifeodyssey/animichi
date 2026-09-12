import type { SelectedPlace } from "./selected-places";
import type { TravelConditions } from "./trip-conditions";

/** A model estimate of time at a stop, never a transit duration or arrival time. */
export interface StayEstimate {
  readonly minMinutes: number;
  readonly maxMinutes: number;
}

export interface DraftStop {
  readonly place: SelectedPlace;
  readonly suggestion?: string;
  readonly stayEstimate?: StayEstimate;
}

/** Already ordered by the caller. The view retains every supplied place and viewpoint. */
export interface ItineraryDraftPlan {
  readonly id: string;
  readonly title: string;
  readonly conditions: TravelConditions;
  readonly introduction?: string;
  readonly stops: readonly DraftStop[];
  /** Explicit planning assumptions, kept separate from the user's known conditions. */
  readonly assumptions: readonly string[];
}

export type DraftRevision = Readonly<{ state: "updating" }> | Readonly<{ state: "failed"; onRetry: () => void }>;

export function validStayEstimate(estimate: StayEstimate): boolean {
  return Number.isFinite(estimate.minMinutes) && Number.isFinite(estimate.maxMinutes) && estimate.minMinutes > 0 && estimate.maxMinutes >= estimate.minMinutes;
}
