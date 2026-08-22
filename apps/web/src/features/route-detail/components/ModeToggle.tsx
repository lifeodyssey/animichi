import type { RouteDetailCopy } from "../lib/copy";
import type { RouteMode } from "../lib/mode";

/**
 * The MODE toggle (spec-route-detail §2): a single control that flips the page
 * between compact idle and map-expanded. Wears the cream 3D press button
 * language. Presentational — the debounce guard and FLIP timing live in
 * `useRouteMode`; this button only reflects and requests.
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
    <button type="button" onClick={onToggle} aria-pressed={expanded} className="route-press">
      {label}
    </button>
  );
}
