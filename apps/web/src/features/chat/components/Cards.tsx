import type { ChatDataPart } from "@animichi/contract";
import { toSearchSpots } from "../lib/spot-clusters";
import type { ChatDict } from "../i18n";
import { SearchResult } from "./SearchResult";

export type IntentCardProps = Readonly<{ part: ChatDataPart; dict: ChatDict }>;

type PartData = NonNullable<ChatDataPart["data"]>;

function dataOf(part: ChatDataPart): PartData | undefined {
  return part.data;
}

export function resultsOf(part: ChatDataPart) {
  const data = dataOf(part);
  return data && "results" in data ? data.results : undefined;
}

export function routeOf(part: ChatDataPart) {
  const data = dataOf(part);
  return data && "itinerary" in data ? data.itinerary : undefined;
}

export function candidatesOf(part: ChatDataPart) {
  const data = dataOf(part);
  return data && "candidates" in data ? (data.candidates ?? []) : [];
}

export type SpotRow = Readonly<{
  id?: string;
  name?: string;
  screenshot_url?: string;
  ep?: number;
  episode?: number;
  lat?: number;
  lng?: number;
  latitude?: number;
  longitude?: number;
  city?: string;
}>;

/** C3a/C3b search shape (issue #261 S1.4): spot cards + static map / bubbles. */
export function SearchCard({ part, dict }: IntentCardProps) {
  const results = resultsOf(part);
  return (
    <div className="grid gap-4">
      {results?.title ? <h3 className="text-xl font-extrabold leading-snug text-fg">{results.title}</h3> : null}
      <SearchResult spots={toSearchSpots(results?.rows ?? [])} dict={dict} />
    </div>
  );
}

export function ProseCard(_props: IntentCardProps) {
  return null;
}
