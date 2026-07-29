import type { AnimeCopy } from "./copy";
import type { FactSummary } from "./fact-summary";

interface FactEntry {
  readonly label: string;
  readonly sentence: string;
}

type Props = Readonly<{ summary: FactSummary; copy: AnimeCopy }>;

function cityList(summary: FactSummary): string {
  return summary.topCities.map((city) => city.region).join("、");
}

function headFacts(summary: FactSummary, copy: AnimeCopy): FactEntry[] {
  return [
    { label: copy.spotsLabel, sentence: copy.spotCountFact(summary.spotCount) },
    { label: copy.citiesLabel, sentence: copy.topCitiesFact(cityList(summary)) },
  ];
}

function durationFacts(summary: FactSummary, copy: AnimeCopy): FactEntry[] {
  if (summary.durationMinutes === null) return [];
  return [{ label: copy.durationLabel, sentence: copy.durationFact(summary.durationMinutes) }];
}

function tailFacts(summary: FactSummary, copy: AnimeCopy): FactEntry[] {
  return [
    { label: copy.routesLabel, sentence: copy.routesFact(summary.routeCount) },
    { label: copy.sourceLabel, sentence: copy.attribution },
  ];
}

function factEntries(summary: FactSummary, copy: AnimeCopy): FactEntry[] {
  return [...headFacts(summary, copy), ...durationFacts(summary, copy), ...tailFacts(summary, copy)];
}

function Fact({ label, sentence }: FactEntry) {
  return (
    <div className="rounded-xl bg-[var(--color-bg)] px-3 py-2">
      <dt className="text-sm font-bold text-[var(--color-muted-fg)]">{label}</dt>
      <dd className="m-0 text-[var(--color-fg)]">{sentence}</dd>
    </div>
  );
}

/** Above-the-fold SEO/GEO fact block: `<section>+<dl>`, one citable sentence per fact. */
export function FactSummaryBlock({ summary, copy }: Props) {
  return (
    <section aria-labelledby="anime-facts" className="rounded-2xl bg-[var(--color-card)] p-4">
      <h2 id="anime-facts" className="mt-0 text-lg">{copy.factsHeading}</h2>
      <dl className="m-0 grid gap-2">
        {factEntries(summary, copy).map((fact) => <Fact key={fact.label} {...fact} />)}
      </dl>
    </section>
  );
}
