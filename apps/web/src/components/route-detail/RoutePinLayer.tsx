import type { RouteDetailCopy } from "../../lib/route-detail/copy";
import { pinBadge, pinSizePx } from "../../lib/route-detail/pinState";
import type { PinState, RoutePin } from "../../lib/route-detail/pinState";

/**
 * The map pin layer (spec-route-detail §5 "pin-is-the-picture"): each stop is a
 * 48px framed marker — 済 ✓ teal, 現在 ★ 58px gold ring, or a plain white
 * numbered not-yet-visited marker. Token-driven so the palette stays semantic.
 */
interface RoutePinLayerProps {
  readonly pins: readonly RoutePin[];
  readonly copy: RouteDetailCopy;
}

const PIN_TONE: Record<PinState, string> = {
  visited: "bg-[var(--color-map-pin-teal)] text-[var(--color-primary-fg)]",
  current: "bg-[var(--color-focus)] text-[var(--color-fg)] ring-4 ring-[var(--color-focus)]",
  unvisited: "bg-[var(--color-bg)] text-[var(--color-fg)] border border-[var(--color-muted-fg)]",
};

function pinName(state: PinState, copy: RouteDetailCopy): string {
  if (state === "visited") return copy.pinVisited;
  return state === "current" ? copy.pinCurrent : copy.pinUnvisited;
}

function Pin({ pin, copy }: { readonly pin: RoutePin; readonly copy: RouteDetailCopy }) {
  const size = `${String(pinSizePx(pin.state))}px`;
  return (
    <li data-state={pin.state} aria-label={`${pinName(pin.state, copy)} ${pin.label}`}
      style={{ width: size, height: size }}
      className={`grid place-items-center rounded-full font-bold ${PIN_TONE[pin.state]}`}>
      {pinBadge(pin.state) ?? pin.label}
    </li>
  );
}

export function RoutePinLayer({ pins, copy }: RoutePinLayerProps) {
  return (
    <ul aria-label="ピン" className="flex flex-wrap items-center gap-2">
      {pins.map((pin) => (
        <Pin key={pin.id} pin={pin} copy={copy} />
      ))}
    </ul>
  );
}
