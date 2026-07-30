import type { TimedStop } from "@animichi/contract";
import type { ShioriRouteProps } from "../types";
import { ShioriFrame, ShioriHeader } from "./ShioriChrome";

/** ポスター: cover-poster fallback when no 対比図 exists yet. */
export function PosterFallback({ meta, itinerary }: ShioriRouteProps) {
  return (
    <ShioriFrame layout="poster-fallback" label="完走ポスター">
      <CompletionBadge stopCount={itinerary.stops.length} />
      <ShioriHeader eyebrow="SEICHIJUNREI · 完走記念" meta={meta} />
      <PosterStops stops={itinerary.stops} />
    </ShioriFrame>
  );
}

function CompletionBadge({ stopCount }: Readonly<{ stopCount: number }>) {
  const count = String(stopCount);
  return (
    <p className="shiori-badge">
      <strong className="shiori-badge__count">{`${count}/${count}`}</strong>
      <span className="shiori-badge__label">完走</span>
    </p>
  );
}

function PosterStops({ stops }: Readonly<{ stops: TimedStop[] }>) {
  if (stops.length === 0) return null;
  return (
    <ul className="shiori-poster-stops">
      {stops.map((stop) => (
        <PosterStopRow key={stop.cluster_id} stop={stop} />
      ))}
    </ul>
  );
}

function PosterStopRow({ stop }: Readonly<{ stop: TimedStop }>) {
  return (
    <li className="shiori-poster-stop">
      <span className="shiori-poster-stop__time">{stop.arrive}</span>
      <span className="shiori-poster-stop__name">{stop.name}</span>
      <VisitedCheck />
    </li>
  );
}

function VisitedCheck() {
  return (
    <span className="shiori-poster-stop__check" aria-label="訪問済み">
      ✓
    </span>
  );
}
