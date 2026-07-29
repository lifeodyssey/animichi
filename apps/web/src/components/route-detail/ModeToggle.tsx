import type { RouteDetailCopy } from "../../lib/route-detail/copy";
import type { RouteMode } from "../../lib/route-detail/mode";

/**
 * The MODE toggle (spec-route-detail §2): a single control that flips the page
 * between compact idle and map-expanded. Presentational — the debounce guard and
 * FLIP timing live in `useRouteMode`; this button only reflects and requests.
 */
interface ModeToggleProps {
  readonly mode: RouteMode;
  readonly onToggle: () => void;
  readonly copy: RouteDetailCopy;
}

export function ModeToggle({ mode, onToggle, copy }: ModeToggleProps) {
  const expanded = mode === "expanded";
  const label = expanded ? copy.mapCollapse : copy.mapExpand;
  return (
    <button type="button" onClick={onToggle} aria-pressed={expanded}
      className="rounded-full bg-[var(--color-muted)] px-3 py-1 text-sm font-bold text-[var(--color-fg)]">
      {label}
    </button>
  );
}
