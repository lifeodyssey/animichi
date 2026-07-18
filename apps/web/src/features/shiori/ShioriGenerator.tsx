import { type ChangeEvent, useCallback, useState } from "react";
import type { Locale } from "../../i18n/locales";
import { composeShiori, type ComposedShiori, type ShioriSource } from "./compose";
import { shioriLabels, type ShioriLabels } from "./labels";
import { ShioriCard } from "./ShioriCard";

export type ShioriGeneratorProps = Readonly<{
  source: ShioriSource;
  locale: Locale;
  onRetainExifChange?: (retainExif: boolean) => void;
}>;

/** S4.2 generation screen: the route data alone picks planned vs commemorative. */
export function ShioriGenerator({ source, locale, onRetainExifChange }: ShioriGeneratorProps) {
  const composed = composeShiori(source);
  return (
    <section className="shiori-generator" aria-label={shioriLabels(locale).modeName[composed.mode]}>
      <GeneratorSummary locale={locale} composed={composed} />
      <GeneratorPreview composed={composed} />
      <RetainExifOptIn label={shioriLabels(locale).retainExif} onChange={onRetainExifChange} />
    </section>
  );
}

type GeneratorSummaryProps = Readonly<{ locale: Locale; composed: ComposedShiori }>;

function GeneratorSummary({ locale, composed }: GeneratorSummaryProps) {
  const labels = shioriLabels(locale);
  return (
    <header className="shiori-generator__summary">
      <h2 className="shiori-generator__mode">{labels.modeName[composed.mode]}</h2>
      <p className="shiori-generator__stats">{labels.statsLine(composed.stats)}</p>
      <CompletionLine labels={labels} composed={composed} />
    </header>
  );
}

type CompletionLineProps = Readonly<{ labels: ShioriLabels; composed: ComposedShiori }>;

function CompletionLine({ labels, composed }: CompletionLineProps) {
  if (!composed.completion) return null;
  return (
    <p className="shiori-generator__completion">{labels.completionLine(composed.completion)}</p>
  );
}

function GeneratorPreview({ composed }: Readonly<{ composed: ComposedShiori }>) {
  return (
    <ShioriCard
      status={composed.status}
      meta={composed.meta}
      itinerary={composed.itinerary}
      photos={composed.photos}
    />
  );
}

function useRetainExif(onChange?: (retainExif: boolean) => void) {
  const [retainExif, setRetainExif] = useState(false);
  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setRetainExif(event.target.checked);
    onChange?.(event.target.checked);
  }, [onChange]);
  return { retainExif, handleChange };
}

type RetainExifOptInProps = Readonly<{
  label: string;
  onChange?: (retainExif: boolean) => void;
}>;

/** Unchecked by default: EXIF stripping stays on unless the user opts in (X6). */
function RetainExifOptIn({ label, onChange }: RetainExifOptInProps) {
  const { retainExif, handleChange } = useRetainExif(onChange);
  return (
    <label className="shiori-generator__exif">
      <input type="checkbox" checked={retainExif} onChange={handleChange} />
      {label}
    </label>
  );
}
