import type { CSSProperties, ChangeEvent } from "react";
import { useState } from "react";
import { useDict } from "../../i18n/context";

const ANIME_SRC = "/images/landing/suga-shrine-anime-source.webp";
const REAL_SRC = "/images/landing/suga-shrine-reality-perspective-v2.webp";

interface Reveal {
  reveal: number;
  style: CSSProperties;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

function useReveal(): Reveal {
  const [reveal, setReveal] = useState(50);
  const style = { "--reveal": `${String(reveal)}%` } as CSSProperties;
  const onChange = (event: ChangeEvent<HTMLInputElement>) => { setReveal(Number(event.target.value)); };
  return { reveal, style, onChange };
}

interface PaneProps {
  variant: "anime" | "real";
  src: string;
  alt: string;
  label: string;
}

function Pane({ variant, src, alt, label }: PaneProps) {
  return (
    <div className={`comparison__pane comparison__pane--${variant}`}>
      <img className="comparison__photo" src={src} alt={alt} loading="lazy" />
      <span className={`comparison__tag comparison__tag--${variant}`}><span className="comparison__dot" aria-hidden="true" />{label}</span>
    </div>
  );
}

/**
 * Anime/real before-after slider. The range input is an invisible full-cover
 * control (so it never overlaps the corner tags on mobile); the visible seam
 * + handle track `--reveal`.
 */
function SliderOverlay() {
  return (<>
    <span className="comparison__seam" aria-hidden="true" />
    <span className="comparison__handle" aria-hidden="true">‹›</span>
  </>);
}

export function ComparisonSlider() {
  const landing = useDict().landing;
  const { reveal, style, onChange } = useReveal();
  return (<figure className="comparison" style={style}>
    <Pane variant="real" src={REAL_SRC} alt={landing.comparison_real_alt} label={landing.comparison_real} />
    <Pane variant="anime" src={ANIME_SRC} alt={landing.comparison_anime_alt} label={landing.comparison_anime} />
    <SliderOverlay />
    <input className="comparison__range" type="range" min={0} max={100} value={reveal} aria-label={landing.comparison_aria} onChange={onChange} />
  </figure>);
}
