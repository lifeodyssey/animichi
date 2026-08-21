import type { ReactElement } from "react";
import { useDict } from "../../i18n/LocaleProvider";
import { HeroSceneCard } from "./HeroSceneCard";
import { HeroSearch } from "./HeroSearch";
import { SparkIcon } from "./SparkIcon";

interface HeroProps {
  /** Carries the search query: the landing is not a navigation surface, so the
   * caller decides what to do with it (login-with-return-target, navigate…). */
  onStart: (query: string) => void;
}

function EyebrowIcon(): ReactElement {
  return (
    <svg className="hero-journal__eyebrow-icon" viewBox="0 0 24 24" fill="#1c9b8e" aria-hidden="true">
      <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Z" />
      <circle cx="12" cy="9" r="2.6" fill="#fffdf5" />
    </svg>
  );
}

function HeroCopy({ onStart }: HeroProps) {
  const landing = useDict().landing;
  return (<div className="hero-journal__copy">
    <p className="hero-journal__eyebrow"><EyebrowIcon /><span className="hero-journal__eyebrow-text">{landing.eyebrow}</span></p>
    <h1 id="hero-title" className="hero-journal__title">{landing.headline_pre}<em>{landing.headline_em}</em></h1>
    <SparkIcon className="hero-spark hero-spark--head" />
    <p className="hero-journal__lead">{landing.lead}</p>
    <HeroSearch onSubmit={onStart} />
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
