import type { CSSProperties, ChangeEvent } from "react";
import { useState } from "react";
import { useDict } from "../../i18n/context";

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

function Pane({ variant, label }: { variant: string; label: string }) {
  return (
    <div className={`comparison__pane comparison__pane--${variant}`} aria-hidden>
      <span className="comparison__tag">{label}</span>
    </div>
  );
}

/** Anime/real before-after slider; the range input drives the reveal width. */
export function ComparisonSlider() {
  const landing = useDict().landing;
  const { reveal, style, onChange } = useReveal();
  return (
    <figure className="comparison" style={style}>
      <Pane variant="real" label={landing.comparison_real} />
      <Pane variant="anime" label={landing.comparison_anime} />
      <input className="comparison__range" type="range" min={0} max={100} value={reveal} aria-label={landing.comparison_aria} onChange={onChange} />
    </figure>);
}
