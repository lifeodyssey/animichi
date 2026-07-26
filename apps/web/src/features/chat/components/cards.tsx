import type { ChatDataPart } from "@seichijunrei/contract";
import { toSearchSpots } from "../../../lib/chat/spotClusters";
import type { ChatDict } from "../i18n";
import { SceneThumb } from "./ErrorStates/SceneThumb";
import { SearchResult } from "./SearchResult";

export type IntentCardProps = Readonly<{ part: ChatDataPart; dict: ChatDict }>;

type PartData = NonNullable<ChatDataPart["data"]>;

function dataOf(part: ChatDataPart): PartData | undefined {
  return part.data;
}

function resultsOf(part: ChatDataPart) {
  const data = dataOf(part);
  return data && "results" in data ? data.results : undefined;
}

function routeOf(part: ChatDataPart) {
  const data = dataOf(part);
  return data && "route" in data ? data.route : undefined;
}

function candidatesOf(part: ChatDataPart) {
  const data = dataOf(part);
  return data && "candidates" in data ? (data.candidates ?? []) : [];
}

type SpotRow = Readonly<{
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

/** Streamed routes may carry spots only as `route.ordered_points` objects. */
function routeSpotsOf(part: ChatDataPart): SpotRow[] {
  const points = routeOf(part)?.ordered_points ?? [];
  const spots: SpotRow[] = [];
  for (const point of points) {
    if (typeof point !== "string") spots.push(point);
  }
  return spots;
}

function spotsOf(part: ChatDataPart): SpotRow[] {
  const rows = resultsOf(part)?.rows ?? [];
  return rows.length > 0 ? rows : routeSpotsOf(part);
}

function epOf(row: SpotRow): number | undefined {
  return row.ep ?? row.episode;
}

/** The thumb renders only for rows that carry a still; D9 degrades it. */
function SpotItem({ row, dict }: Readonly<{ row: SpotRow; dict: ChatDict }>) {
  return (
    <li className="chat-spot">
      {row.screenshot_url ? <SceneThumb src={row.screenshot_url} alt={row.name ?? ""} ep={epOf(row)} dict={dict} /> : null}
      <span>{row.name}</span>
    </li>
  );
}

function SpotList({ part, dict }: IntentCardProps) {
  const rows = spotsOf(part);
  if (rows.length === 0) return null;
  const items = rows.map((row) => <SpotItem key={row.id ?? row.name} row={row} dict={dict} />);
  return <ul className="chat-card__spots">{items}</ul>;
}

/** C3a/C3b search shape (issue #261 S1.4): spot cards + static map / bubbles. */
export function SearchCard({ part, dict }: IntentCardProps) {
  const results = resultsOf(part);
  return (
    <div className="chat-card__body">
      {results?.title ? <p className="chat-card__title">{results.title}</p> : null}
      <SearchResult spots={toSearchSpots(spotsOf(part))} dict={dict} />
    </div>
  );
}

function RouteStats({ part }: Readonly<{ part: ChatDataPart }>) {
  const route = routeOf(part);
  if (!route) return null;
  return (
    <p className="chat-card__stats">
      {route.point_count ?? 0} spots · {route.total_walk_minutes ?? "?"} min
    </p>
  );
}

export function RouteCard({ part, dict }: IntentCardProps) {
  return (
    <div className="chat-card__body">
      <RouteStats part={part} />
      <SpotList part={part} dict={dict} />
    </div>
  );
}

export function ClarifyCard({ part }: IntentCardProps) {
  return (
    <ul className="chat-card__candidates" aria-label="candidates">
      {candidatesOf(part).map((candidate) => (
        <li key={candidate.id ?? candidate.title}>{candidate.title}</li>
      ))}
    </ul>
  );
}

export function ProseCard(_props: IntentCardProps) {
  return null;
}
