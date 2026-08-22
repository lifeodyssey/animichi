import type { RouteDetailCopy } from "../lib/copy";
import type { RouteMode } from "../lib/mode";
import type { RoutePin } from "../lib/pin-state";
import { ModeToggle } from "./ModeToggle";
import { RoutePinLayer } from "./RoutePinLayer";

/**
 * The map card (spec-route-detail §2/§5). The map is the card's face: the gold
 * route pill (N/5) floats over the stage and the operable row sits under it as
 * the card's foot, divided by the 2px block line. Idle ⇄ map-expanded animates
 * the stage over the 360ms FLIP budget (`--route-mode-ms` in route-detail.css).
 *
 * A product-specific generative component (SD-13 catalog): its payload carries
 * a `schema_version` for additive-only evolution and is partial-tolerant — a
 * payload missing its pins renders the skeleton slot rather than crashing, so a
 * legacy Chat registry payload is safe.
 */
export interface MapCardPayload {
  readonly schema_version: number;
  readonly pins?: readonly RoutePin[];
  readonly progress?: string;
  readonly placeholder?: string;
}

interface MapCardProps {
  readonly payload: MapCardPayload;
  readonly copy: RouteDetailCopy;
  readonly mode: RouteMode;
  readonly onToggle: () => void;
}

function MapCardSkeleton({ copy }: { readonly copy: RouteDetailCopy }) {
  return <div role="status" aria-label={copy.loadingLabel} className="route-skeleton route-skeleton--map" />;
}

function RouteProgressPill({ progress, copy }: { readonly progress: string; readonly copy: RouteDetailCopy }) {
  return (
    <span aria-label={copy.progressAria} className="route-pill route-pill--gold route-map__pill">
      {progress}
    </span>
  );
}

function MapCardBar({ mode, onToggle, copy }: Omit<MapCardProps, "payload">) {
  return (
    <div className="route-map__bar">
      <span className="route-map__hint">{copy.mapHint}</span>
      <ModeToggle mode={mode} onToggle={onToggle} copy={copy} />
    </div>
  );
}

interface MapStageProps {
  readonly mode: RouteMode;
  readonly pins: readonly RoutePin[];
  readonly copy: RouteDetailCopy;
  readonly placeholder: string;
  readonly progress?: string;
}

function MapStage({ mode, pins, copy, placeholder, progress }: MapStageProps) {
  const minHeight = mode === "expanded" ? "18rem" : "9rem";
  return (
    <div style={{ minHeight }} className="route-map__stage">
      {progress ? <RouteProgressPill progress={progress} copy={copy} /> : null}
      <span>{placeholder}</span>
      <RoutePinLayer pins={pins} copy={copy} />
    </div>
  );
}

export function MapCard({ payload, copy, mode, onToggle }: MapCardProps) {
  if (!payload.pins) return <MapCardSkeleton copy={copy} />;
  return (
    <section aria-label="地図" aria-expanded={mode === "expanded"} className="route-card">
      <MapStage mode={mode} pins={payload.pins} copy={copy} progress={payload.progress}
        placeholder={payload.placeholder ?? copy.mapPlaceholder} />
      <MapCardBar mode={mode} onToggle={onToggle} copy={copy} />
    </section>
  );
}
