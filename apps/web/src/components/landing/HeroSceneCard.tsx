import { ComparisonSlider } from "./ComparisonSlider";
import { SparkIcon } from "./SparkIcon";

/** Journal scene card — a tilted washi-taped frame around the anime/real comparison, fox leaning over the corner. */
export function HeroSceneCard() {
  return (
    <div className="scene-card">
      <SparkIcon className="scene-card__spark scene-card__spark--upper" />
      <SparkIcon className="scene-card__spark scene-card__spark--lower" />
      <img className="scene-card__fox" src="/images/landing/fox/fox-lean.svg" alt="" aria-hidden="true" width={202} height={154} />
      <div className="scene-card__frame"><ComparisonSlider /></div>
    </div>
  );
}
