import { ComparisonSlider } from "./ComparisonSlider";

/** Journal scene card — a tilted cream frame around the anime/real comparison, fox peeking over the corner. */
export function HeroSceneCard() {
  return (
    <div className="scene-card">
      <img className="scene-card__fox" src="/images/landing/fox-peek.webp" alt="" aria-hidden="true" width={202} height={154} />
      <div className="scene-card__frame"><ComparisonSlider /></div>
    </div>
  );
}
