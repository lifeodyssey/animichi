import type { ChatDataPart } from "@seichijunrei/contract";
import type { ChatDict } from "../i18n";

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

type PartOnlyProps = Readonly<{ part: ChatDataPart }>;

type SpotRow = Readonly<{ id?: string; name?: string }>;

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

function SpotList({ part }: PartOnlyProps) {
  const rows = spotsOf(part);
  if (rows.length === 0) return null;
  const items = rows.map((row) => <li key={row.id ?? row.name}>{row.name}</li>);
  return <ul className="chat-card__spots">{items}</ul>;
}

export function SearchCard({ part }: IntentCardProps) {
  const results = resultsOf(part);
  return (
    <div className="chat-card__body">
      {results?.title ? <p className="chat-card__title">{results.title}</p> : null}
      <SpotList part={part} />
    </div>
  );
}

function RouteStats({ part }: PartOnlyProps) {
  const route = routeOf(part);
  if (!route) return null;
  return (
    <p className="chat-card__stats">
      {route.point_count ?? 0} spots · {route.total_walk_minutes ?? "?"} min
    </p>
  );
}

export function RouteCard({ part }: IntentCardProps) {
  return (
    <div className="chat-card__body">
      <RouteStats part={part} />
      <SpotList part={part} />
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

function ErrorList({ part }: PartOnlyProps) {
  const errors = part.errors ?? [];
  if (errors.length === 0) return null;
  const items = errors.map((error) => (
    <li key={`${error.code}:${error.message}`}>{error.message}</li>
  ));
  return <ul className="chat-card__errors">{items}</ul>;
}

export function ErrorCard({ part, dict }: IntentCardProps) {
  return (
    <div className="chat-card__body" role="alert">
      {part.message ? null : <p className="chat-card__message">{dict.errorCard}</p>}
      <ErrorList part={part} />
    </div>
  );
}
