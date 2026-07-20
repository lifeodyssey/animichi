import type { RouteDetailCopy } from "../../lib/route-detail/copy";
import { MODE_EASING, MODE_TRANSITION_MS } from "../../lib/route-detail/mode";
import type { RouteMode } from "../../lib/route-detail/mode";
import type { RoutePin } from "../../lib/route-detail/pinState";
import { ModeToggle } from "./ModeToggle";
import { RoutePinLayer } from "./RoutePinLayer";

/**
 * The map card (spec-route-detail §2/§5). A product-specific generative
 * component (SD-13 catalog): its payload carries a `schema_version` for
 * additive-only evolution and is partial-tolerant — a payload missing its pins
 * renders the skeleton slot rather than crashing, so a legacy Chat registry
 * payload is safe. Idle ⇄ map-expanded is a 360ms FLIP; a gold pill shows N/5.
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
  return (
    <div role="status" aria-label={copy.loadingLabel}
      className="h-36 w-full animate-pulse rounded-2xl bg-[var(--color-muted)]" />
  );
}

function RouteProgressPill({ progress, copy }: { readonly progress: string; readonly copy: RouteDetailCopy }) {
  return (
    <span aria-label={copy.progressAria}
      className="rounded-full bg-[var(--color-focus)] px-3 py-1 text-sm font-bold text-[var(--color-fg)]">
      {progress}
    </span>
  );
}

interface MapHeaderProps extends MapCardProps {
  readonly progress?: string;
}

function MapCardHeader({ progress, mode, onToggle, copy }: Omit<MapHeaderProps, "payload">) {
  return (
    <div className="flex items-center justify-between">
      {progress ? <RouteProgressPill progress={progress} copy={copy} /> : null}
      <ModeToggle mode={mode} onToggle={onToggle} copy={copy} />
    </div>
  );
}

interface MapStageProps {
  readonly mode: RouteMode;
  readonly pins: readonly RoutePin[];
  readonly copy: RouteDetailCopy;
  readonly placeholder: string;
}

function MapStage({ mode, pins, copy, placeholder }: MapStageProps) {
  const minHeight = mode === "expanded" ? "18rem" : "9rem";
  return (
    <div style={{ minHeight, transition: `min-height ${String(MODE_TRANSITION_MS)}ms ${MODE_EASING}` }}
      className="grid place-items-center gap-3 rounded-2xl bg-[var(--color-muted)] p-4 text-[var(--color-muted-fg)]">
      <span>{placeholder}</span>
      <RoutePinLayer pins={pins} copy={copy} />
    </div>
  );
}

export function MapCard({ payload, copy, mode, onToggle }: MapCardProps) {
  if (!payload.pins) return <MapCardSkeleton copy={copy} />;
  return (
    <section aria-label="地図" aria-expanded={mode === "expanded"} className="flex flex-col gap-3">
      <MapCardHeader progress={payload.progress} mode={mode} onToggle={onToggle} copy={copy} />
      <MapStage mode={mode} pins={payload.pins} copy={copy}
        placeholder={payload.placeholder ?? copy.mapPlaceholder} />
    </section>
  );
}
