import { useDict } from "../../i18n/context";
import { HeroSceneCard } from "./HeroSceneCard";
import { HeroSearch } from "./HeroSearch";
import { ToriiMark } from "./ToriiMark";

interface HeroProps {
  onStart: () => void;
}

function HeroCopy({ onStart }: HeroProps) {
  const landing = useDict().landing;
  return (<div className="hero-journal__copy">
    <p className="hero-journal__eyebrow"><ToriiMark size={15} />{landing.eyebrow}</p>
    <h1 id="hero-title" className="hero-journal__title">{landing.headline}</h1>
    <p className="hero-journal__lead">{landing.lead}</p>
    <HeroSearch onSubmit={() => { onStart(); }} />
  </div>);
}

/** Journal-card hero: serif sell line + pill search on the left, tilted scene card on the right. */
export function Hero({ onStart }: HeroProps) {
  return (
    <section className="hero-journal" aria-labelledby="hero-title">
      <HeroCopy onStart={onStart} />
      <HeroSceneCard />
    </section>
  );
}
