import "../../styles/anime.css";
import type { AnimeOverview } from "@animichi/contract";
import type { Locale } from "../../i18n/locales";
import { CirclesSection } from "./CirclesSection";
import { FactSummaryBlock } from "./FactSummaryBlock";
import { ScenesSection } from "./ScenesSection";
import { type AnimeCopy, animeCopyFor } from "./copy";
import { buildFactSummary, rankScenes } from "./fact-summary";

export type AnimePageProps = Readonly<{ overview: AnimeOverview; locale: Locale }>;

type ViewProps = Readonly<{ overview: AnimeOverview; copy: AnimeCopy }>;

/** Canvas hero meta row: the work's counts as plain pills (design §4.3). */
function HeroMeta({ overview, copy }: ViewProps) {
  return (
    <ul className="anime-hero__meta">
      <li className="anime-pill anime-pill--plain">{copy.spotUnit(overview.points_length)}</li>
      <li className="anime-pill anime-pill--plain">{copy.areaUnit(overview.circles.length)}</li>
    </ul>
  );
}

function AnimeHero({ overview, copy }: ViewProps) {
  return (
    <header className="anime-hero">
      <p className="eyebrow">Animichi</p>
      <h1 className="anime-hero__title">{copy.h1}</h1>
      <p className="anime-hero__subtitle">{copy.heroSubtitle(overview.bangumi_id)}</p>
      {overview.points_length > 0 ? <HeroMeta overview={overview} copy={copy} /> : null}
    </header>
  );
}

function AnimeEmpty({ overview, copy }: ViewProps) {
  return (
    <main className="anime-page">
      <AnimeHero overview={overview} copy={copy} />
      <section className="anime-card anime-empty">
        <p className="anime-empty__body">{copy.empty}</p>
      </section>
    </main>
  );
}

function AnimeFull({ overview, copy }: ViewProps) {
  return (
    <main className="anime-page">
      <AnimeHero overview={overview} copy={copy} />
      <FactSummaryBlock summary={buildFactSummary(overview)} copy={copy} />
      <ScenesSection scenes={rankScenes(overview.scenes)} copy={copy} />
      <CirclesSection circles={overview.circles} copy={copy} />
    </main>
  );
}

function AnimeBody({ overview, copy }: ViewProps) {
  if (overview.points_length === 0) return <AnimeEmpty overview={overview} copy={copy} />;
  return <AnimeFull overview={overview} copy={copy} />;
}

/**
 * `/anime/:id` presenter: empty-but-valid overviews get the graceful empty
 * state. JSON-LD is emitted by the route's `head()` (see `src/lib/json-ld`),
 * not rendered here.
 */
export function AnimePage({ overview, locale }: AnimePageProps) {
  const copy = animeCopyFor(locale);
  return <AnimeBody overview={overview} copy={copy} />;
}
