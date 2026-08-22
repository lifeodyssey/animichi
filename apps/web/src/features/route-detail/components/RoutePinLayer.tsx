import type { RouteDetailCopy } from "../lib/copy";
import { pinBadge, pinSizePx } from "../lib/pin-state";
import type { PinState, RoutePin } from "../lib/pin-state";

/**
 * The map pin layer (spec-route-detail §5 "pin-is-the-picture"): each stop is a
 * 48px framed marker — paper edge, 13px radius, pointer tail, 3D drop — reading
 * 済 ✓ teal, 現在 ★ 58px gold ring, or a plain numbered not-yet-visited frame.
 * Tone and geometry are token- and data-driven so the palette stays semantic.
 */
interface RoutePinLayerProps {
  readonly pins: readonly RoutePin[];
  readonly copy: RouteDetailCopy;
}

function pinName(state: PinState, copy: RouteDetailCopy): string {
  if (state === "visited") return copy.pinVisited;
  return state === "current" ? copy.pinCurrent : copy.pinUnvisited;
}

function Pin({ pin, copy }: { readonly pin: RoutePin; readonly copy: RouteDetailCopy }) {
  const size = `${String(pinSizePx(pin.state))}px`;
  return (
    <li data-state={pin.state} aria-label={`${pinName(pin.state, copy)} ${pin.label}`}
      style={{ width: size, height: size }} className="route-pin">
      {pinBadge(pin.state) ?? pin.label}
    </li>
  );
}

export function RoutePinLayer({ pins, copy }: RoutePinLayerProps) {
  return (
    <ul aria-label="ピン" className="route-pin-layer">
      {pins.map((pin) => (
        <Pin key={pin.id} pin={pin} copy={copy} />
      ))}
    </ul>
  );
}
