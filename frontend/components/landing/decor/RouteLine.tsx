import { cn } from "@/lib/utils";

interface RouteLineProps {
  /** Intermediate waypoint dots between the two pins. */
  stops?: number;
  /** Render the end (coral) pin. */
  endPin?: boolean;
  className?: string;
}

/**
 * Dashed walking route between a teal start pin and a coral destination pin,
 * the spatial signature that ties scene → real place → plan across the page.
 * Stretches to its container width; the curve is intentionally hand-wavy.
 */
export default function RouteLine({
  stops = 0,
  endPin = true,
  className,
}: RouteLineProps) {
  const xs = Array.from({ length: stops }, (_, i) => 30 + ((i + 1) * 240) / (stops + 1));
  return (
    <svg
      viewBox="0 0 300 36"
      fill="none"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn("h-9 w-full overflow-visible", className)}
    >
      <path
        d="M14 24 C70 6, 120 30, 160 16 C210 0, 250 26, 286 14"
        stroke="var(--color-primary)"
        strokeWidth="2.5"
        strokeDasharray="7 6"
        strokeLinecap="round"
        opacity="0.7"
      />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy="18" r="2.6" fill="var(--color-border)" />
      ))}
      <Pin x={14} y={24} color="var(--color-primary)" />
      {endPin ? <Pin x={286} y={14} color="var(--color-marker-active)" /> : null}
    </svg>
  );
}

function Pin({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x - 7} ${y - 18})`}>
      <path
        d="M7 0C3.13 0 0 3.13 0 7c0 5.25 7 11 7 11s7-5.75 7-11C14 3.13 10.87 0 7 0z"
        fill={color}
      />
      <circle cx="7" cy="6.8" r="2.6" fill="var(--color-bg)" />
    </g>
  );
}
