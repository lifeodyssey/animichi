/**
 * RouteTrail — the hand-drawn journey doodle behind the hero. A fine dashed
 * line wanders in from the left page edge, waves through the gap between the
 * search bar and the example chips (two small espresso pins float on its
 * crests), dives below the showcase card and swings back up into a chevron
 * arrow that points at a gold destination pin. A second, fainter dashed
 * "ground line" drifts across the full width just above the footer.
 */

/**
 * Wandering main trail, drawn like a happy doodle: a calm drift over the
 * example label, two round bouncing hills (their valleys cradle the chip
 * row, their crests carry the waypoint pins), a little loop-de-loop spin in
 * the open pocket after the second hill, then a soft dive that swings back
 * up into the arrow and the gold destination pin.
 */
const TRAIL_PATH = [
  "M -14 500",
  "C 50 506, 120 502, 195 498",
  "C 256 495, 288 519, 322 519",
  "C 362 519, 388 477, 424 477",
  "C 454 477, 478 521, 512 521",
  "C 546 521, 568 477, 596 477",
  "C 612 473, 628 481, 642 490",
  "C 670 499, 688 518, 670 532",
  "C 654 543, 630 536, 628 518",
  "C 626 502, 642 490, 662 491",
  "C 690 494, 714 505, 738 521",
  "C 764 539, 794 556, 820 555",
  "C 842 554, 856 540, 866 527",
].join(" ");

/** Faint ground line drifting across the bottom of the hero band. */
const GROUND_PATH = "M -20 592 C 240 582, 480 602, 740 592 S 1140 578, 1460 592";

export default function RouteTrail() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1440 600"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      <path
        className="stroke-fg"
        d={TRAIL_PATH}
        strokeWidth="3"
        strokeDasharray="9 14"
        strokeLinecap="round"
        opacity="0.8"
      />
      <path
        className="stroke-fg"
        d="M 890 521 L 908 530 L 898 547"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
      <path
        className="stroke-fg"
        d={GROUND_PATH}
        strokeWidth="2.5"
        strokeDasharray="9 15"
        strokeLinecap="round"
        opacity="0.35"
      />

      <TrailPin x={34} y={498} tone="teal" scale={1.15} />
      <TrailPin x={424} y={473} tone="ink" scale={1} />
      <TrailPin x={596} y={473} tone="ink" scale={1.1} />
      <ellipse className="fill-3d-shadow" cx="946" cy="572" rx="17" ry="5" opacity="0.55" />
      <TrailPin x={946} y={568} tone="gold" scale={2.1} tilt={-7} />
      <path
        className="fill-cta"
        d="M 985 495 Q 986.5 500.5 992 502 Q 986.5 503.5 985 509 Q 983.5 503.5 978 502 Q 983.5 500.5 985 495 Z"
        opacity="0.9"
      />
      <circle className="fill-cta" cx="1004" cy="517" r="2.5" opacity="0.75" />
    </svg>
  );
}

interface TrailPinProps {
  x: number;
  y: number;
  /** teal = journey start, ink = espresso waypoint, gold = the destination. */
  tone: "teal" | "ink" | "gold";
  scale: number;
  /** Playful lean in degrees, rotating around the pin tip. */
  tilt?: number;
}

const PIN_BODY: Record<TrailPinProps["tone"], string> = {
  teal: "fill-primary",
  ink: "fill-fg",
  gold: "fill-cta",
};

/**
 * A teardrop map pin with its tip anchored at (x, y). Colors come via
 * Tailwind `fill-*` classes: `var()` does not resolve inside SVG presentation
 * attributes (it silently inherits the root `fill="none"`).
 */
function TrailPin({ x, y, tone, scale, tilt = 0 }: TrailPinProps) {
  const body = PIN_BODY[tone];
  const hole = tone === "ink" ? "fill-background" : "fill-primary-fg";
  return (
    <g transform={`translate(${String(x - 9 * scale)} ${String(y - 24 * scale)}) scale(${String(scale)}) rotate(${String(tilt)} 9 24)`}>
      <path
        className={body}
        d="M9 0C4.03 0 0 4.03 0 9c0 6.75 9 15 9 15s9-8.25 9-15C18 4.03 13.97 0 9 0z"
      />
      <circle className={hole} cx="9" cy="8.7" r="3.2" />
    </g>
  );
}
