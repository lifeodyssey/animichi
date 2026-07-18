import type { AnimeOverview } from "@seichijunrei/contract";
import type { Locale } from "../../i18n/locales";
import { CirclesSection } from "./CirclesSection";
import { FactSummaryBlock } from "./FactSummaryBlock";
import { ScenesSection } from "./ScenesSection";
import { type AnimeCopy, animeCopyFor } from "./copy";
import { buildFactSummary, rankScenes } from "./fact-summary";

export type AnimePageProps = Readonly<{ overview: AnimeOverview; locale: Locale }>;

type ViewProps = Readonly<{ overview: AnimeOverview; copy: AnimeCopy }>;

function AnimeHero({ overview, copy }: ViewProps) {
  return (
    <header>
      <p className="eyebrow">Animichi</p>
      <h1 className="mt-1 mb-2">{copy.h1}</h1>
      <p className="mt-0 text-[var(--color-muted-fg)]">{copy.heroSubtitle(overview.bangumi_id)}</p>
    </header>
  );
}

function AnimeEmpty({ overview, copy }: ViewProps) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <AnimeHero overview={overview} copy={copy} />
      <section className="rounded-2xl bg-[var(--color-card)] p-6 text-center">
        <p className="m-0 text-[var(--color-muted-fg)]">{copy.empty}</p>
      </section>
    </main>
  );
}

function AnimeFull({ overview, copy }: ViewProps) {
  return (
    <main className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
      <AnimeHero overview={overview} copy={copy} />
      <FactSummaryBlock summary={buildFactSummary(overview)} copy={copy} />
      <ScenesSection scenes={rankScenes(overview.scenes)} copy={copy} />
      <CirclesSection circles={overview.circles} copy={copy} />
    </main>
  );
}

/** `/anime/:id` presenter: empty-but-valid overviews get the graceful empty state. */
export function AnimePage({ overview, locale }: AnimePageProps) {
  const copy = animeCopyFor(locale);
  if (overview.points_length === 0) return <AnimeEmpty overview={overview} copy={copy} />;
  return <AnimeFull overview={overview} copy={copy} />;
}
