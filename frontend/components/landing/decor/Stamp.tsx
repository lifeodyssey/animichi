import { cn } from "@/lib/utils";

export type StampGlyph = "torii" | "star" | "compass" | "footprint";

interface StampProps {
  /** Short label set centered along the TOP arc (keep it short, e.g. 聖地巡礼). */
  ringText?: string;
  /** Center mark. */
  glyph?: StampGlyph;
  /** Diameter in px. */
  size?: number;
  /** Tilt for a hand-pressed look. */
  rotate?: number;
  className?: string;
}

/**
 * Circular shrine-seal stamp. Short label arcs across the top only (full-circle
 * curved CJK cramps and breaks), a bold center glyph, and three ink dots below.
 * Inked with `stamp-ink` (multiply) so it reads as pressed onto paper.
 */
export default function Stamp({
  ringText,
  glyph = "torii",
  size = 76,
  rotate = -8,
  className,
}: StampProps) {
  const id = `stamp-arc-${glyph}-${ringText?.length ?? 0}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      className={cn("stamp-ink select-none", className)}
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      <defs>
        {/* upper arc, left → right over the top */}
        <path id={id} d="M26 54 A 24 24 0 0 1 74 54" />
      </defs>

      <circle cx="50" cy="50" r="46" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="50" cy="50" r="39" stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" />

      {ringText ? (
        <text
          fontSize="11"
          fontWeight="700"
          letterSpacing="2"
          fill="currentColor"
          textAnchor="middle"
        >
          <textPath href={`#${id}`} startOffset="50%">
            {ringText}
          </textPath>
        </text>
      ) : null}

      <g
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(50 51)"
      >
        <StampGlyphMark glyph={glyph} />
      </g>

      {/* three ink dots along the bottom */}
      <g fill="currentColor" stroke="none">
        <circle cx="42" cy="76" r="1.4" />
        <circle cx="50" cy="77.5" r="1.4" />
        <circle cx="58" cy="76" r="1.4" />
      </g>
    </svg>
  );
}

function StampGlyphMark({ glyph }: { glyph: StampGlyph }) {
  if (glyph === "star")
    return <path d="M0 -12 L4 -4 L12 -3 L6 3 L8 12 L0 7 L-8 12 L-6 3 L-12 -3 L-4 -4 Z" />;
  if (glyph === "compass")
    return (
      <>
        <circle r="12" />
        <path d="M0 -8 L4 4 L0 1 L-4 4 Z" fill="currentColor" />
      </>
    );
  if (glyph === "footprint")
    return (
      <>
        <ellipse cx="0" cy="2" rx="6" ry="8.5" />
        <circle cx="-7" cy="-7" r="2" />
        <circle cx="-2" cy="-10" r="2" />
        <circle cx="4" cy="-9" r="2" />
        <circle cx="8" cy="-5" r="2" />
      </>
    );
  // torii — bolder, bigger
  return (
    <>
      <path d="M-12 -7 H12" />
      <path d="M-10 -2.5 H10" />
      <path d="M-8 -7 V11" />
      <path d="M8 -7 V11" />
    </>
  );
}
