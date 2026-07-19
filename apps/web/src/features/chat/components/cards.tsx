import type { ChatDataPart } from "@seichijunrei/contract";

export type IntentCardProps = Readonly<{ part: ChatDataPart }>;

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

function SpotList({ part }: IntentCardProps) {
  const rows = resultsOf(part)?.rows ?? [];
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

function RouteStats({ part }: IntentCardProps) {
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
