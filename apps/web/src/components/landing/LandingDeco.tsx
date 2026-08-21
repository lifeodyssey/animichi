import type { CSSProperties, ReactElement } from "react";

type PetalTint = "pink" | "rose" | "salmon";

interface PetalSpec {
  readonly left: string;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly delay: number;
  readonly tint: PetalTint;
}

const PETAL_TINTS: Record<PetalTint, string> = {
  pink: "linear-gradient(135deg,#fcd6e1,#f3a6c0)",
  rose: "linear-gradient(135deg,#fde3ec,#f7b8cd)",
  salmon: "linear-gradient(135deg,#fbcdda,#ef9cb8)",
};

/* Transcribed from the design mockup (Landing - Seichijunrei.html, 14 petals). */
const PETALS: readonly PetalSpec[] = [
  { left: "55.3%", width: 14, height: 16, duration: 11.9, delay: -4.4, tint: "pink" },
  { left: "50.1%", width: 14, height: 16, duration: 11.6, delay: -15.8, tint: "rose" },
  { left: "41.0%", width: 15, height: 17, duration: 13.3, delay: -14.1, tint: "salmon" },
  { left: "9.3%", width: 16, height: 18, duration: 15.0, delay: -4.2, tint: "pink" },
  { left: "17.0%", width: 16, height: 18, duration: 15.5, delay: -8.8, tint: "rose" },
  { left: "6.8%", width: 12, height: 13, duration: 18.5, delay: -17.5, tint: "salmon" },
  { left: "44.2%", width: 11, height: 12, duration: 18.6, delay: -3.4, tint: "pink" },
  { left: "54.3%", width: 14, height: 15, duration: 16.4, delay: -5.1, tint: "rose" },
  { left: "95.6%", width: 12, height: 13, duration: 14.6, delay: -4.2, tint: "salmon" },
  { left: "33.4%", width: 15, height: 17, duration: 12.2, delay: -13.9, tint: "pink" },
  { left: "35.3%", width: 13, height: 15, duration: 11.6, delay: -16.7, tint: "rose" },
  { left: "86.0%", width: 12, height: 14, duration: 14.8, delay: -4.2, tint: "salmon" },
  { left: "40.2%", width: 15, height: 17, duration: 17.1, delay: -11.8, tint: "pink" },
  { left: "23.3%", width: 11, height: 13, duration: 14.6, delay: -1.6, tint: "rose" },
];

function petalStyle(petal: PetalSpec): CSSProperties {
  return {
    left: petal.left,
    width: `${String(petal.width)}px`,
    height: `${String(petal.height)}px`,
    animationDuration: `${String(petal.duration)}s`,
    animationDelay: `${String(petal.delay)}s`,
    background: PETAL_TINTS[petal.tint],
  };
}

/** Ambient decoration layer: top-right cherry branch + falling petals. */
export function LandingDeco(): ReactElement {
  return (
    <div className="landing-deco" aria-hidden="true">
      <img className="landing-deco__foliage" src="/images/landing/foliage-tr.svg" alt="" width={382} height={255} />
      {PETALS.map((petal) => (
        <span key={petal.left} className="landing-deco__petal" style={petalStyle(petal)} />
      ))}
    </div>
  );
}
