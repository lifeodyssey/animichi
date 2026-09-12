/** Caller-owned, user-provided facts. Empty strings remain undecided. */
export interface TravelConditions {
  readonly origin: string;
  readonly availableTime: string;
  readonly departureTime: string;
}

export const emptyTravelConditions: TravelConditions = { origin: "", availableTime: "", departureTime: "" };

export function cleanTravelConditions(value: TravelConditions): TravelConditions {
  return { origin: value.origin.trim(), availableTime: value.availableTime.trim(), departureTime: value.departureTime.trim() };
}

export function hasPlanningBasics(value: TravelConditions): boolean {
  return value.origin.trim().length > 0 && value.availableTime.trim().length > 0;
}
