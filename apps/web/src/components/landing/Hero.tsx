import { useDict } from "../../i18n/context";
import { ComparisonSlider } from "./ComparisonSlider";

interface HeroProps {
  onStart: () => void;
}

function HeroCopy({ onStart }: HeroProps) {
  const landing = useDict().landing;
  return (<div className="hero-band__copy">
    <p className="hero-band__eyebrow">{landing.eyebrow}</p>
    <h1 id="hero-title" className="hero-band__title">{landing.hero}<span className="hero-band__accent">{landing.hero_accent}</span></h1>
    <p className="hero-band__subtitle">{landing.subtitle}</p>
    <button className="ds-button ds-button--primary ds-button--large" type="button" onClick={onStart}>{landing.cta}</button>
  </div>);
}

function HeroShowcase() {
  const landing = useDict().landing;
  return (
    <div className="hero-band__showcase">
      <p className="hero-band__showcase-title">{landing.comparison_title}</p>
      <p className="hero-band__showcase-sub">{landing.comparison_sub}</p>
      <ComparisonSlider />
    </div>
  );
}

export function Hero({ onStart }: HeroProps) {
  return (
    <section className="hero-band" aria-labelledby="hero-title">
      <HeroCopy onStart={onStart} />
      <HeroShowcase />
    </section>
  );
}
