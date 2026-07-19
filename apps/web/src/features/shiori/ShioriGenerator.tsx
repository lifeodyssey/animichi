import { type ChangeEvent, useCallback, useEffect, useState } from "react";
import type { Locale } from "../../i18n/locales";
import { composeShiori, type ComposedShiori, type ShioriSource } from "./compose";
import { shioriLabels, type ShioriLabels } from "./labels";
import { ingestShioriPhotos, revokeShioriPhotoUrls } from "./photoIngestion";
import { ShioriCard } from "./ShioriCard";
import type { SanitizedShioriPhoto, ShioriPhotoInput } from "./types";

/** Generator input: photos arrive as raw blobs and can only render after sanitization. */
export interface ShioriGeneratorSource extends Omit<ShioriSource, "photos"> {
  photos: readonly ShioriPhotoInput[];
}

type PhotosSanitizedHandler = (photos: readonly SanitizedShioriPhoto[]) => void;

export type ShioriGeneratorProps = Readonly<{
  source: ShioriGeneratorSource;
  locale: Locale;
  onRetainExifChange?: (retainExif: boolean) => void;
  onPhotosSanitized?: PhotosSanitizedHandler;
}>;

/** S4.2 generation screen: the route data alone picks planned vs commemorative. */
export function ShioriGenerator(props: ShioriGeneratorProps) {
  const { retainExif, handleChange } = useRetainExif(props.onRetainExifChange);
  const photos = useSanitizedPhotos(props.source.photos, retainExif, props.onPhotosSanitized);
  const composed = composeShiori({ ...props.source, photos });
  const view = { locale: props.locale, composed, retainExif, onToggle: handleChange };
  return <GeneratorView {...view} />;
}

type GeneratorViewProps = Readonly<{
  locale: Locale;
  composed: ComposedShiori;
  retainExif: boolean;
  onToggle: (event: ChangeEvent<HTMLInputElement>) => void;
}>;

function GeneratorView({ locale, composed, retainExif, onToggle }: GeneratorViewProps) {
  const labels = shioriLabels(locale);
  return (
    <section className="shiori-generator" aria-label={labels.modeName[composed.mode]}>
      <GeneratorSummary locale={locale} composed={composed} />
      <GeneratorPreview composed={composed} />
      <RetainExifOptIn label={labels.retainExif} checked={retainExif} onChange={onToggle} />
    </section>
  );
}

function useSanitizedPhotos(
  inputs: readonly ShioriPhotoInput[],
  retainExif: boolean,
  onPhotosSanitized?: PhotosSanitizedHandler,
): readonly SanitizedShioriPhoto[] {
  const { photos, deliver } = useDeliveredPhotos(onPhotosSanitized);
  useEffect(() => runIngestion(inputs, retainExif, deliver), [inputs, retainExif, deliver]);
  useEffect(() => () => { revokeShioriPhotoUrls(photos); }, [photos]);
  return photos;
}

function useDeliveredPhotos(onPhotosSanitized?: PhotosSanitizedHandler) {
  const [photos, setPhotos] = useState<readonly SanitizedShioriPhoto[]>([]);
  const deliver = useCallback<PhotosSanitizedHandler>((next) => {
    setPhotos(next);
    onPhotosSanitized?.(next);
  }, [onPhotosSanitized]);
  return { photos, deliver };
}

function runIngestion(
  inputs: readonly ShioriPhotoInput[],
  retainExif: boolean,
  deliver: PhotosSanitizedHandler,
): () => void {
  if (inputs.length === 0) return deliverEmpty(deliver);
  return trackIngestion(ingestShioriPhotos(inputs, { retainExif }), deliver);
}

function deliverEmpty(deliver: PhotosSanitizedHandler): () => void {
  deliver([]);
  return () => undefined;
}

function trackIngestion(pending: PendingPhotos, deliver: PhotosSanitizedHandler): () => void {
  let alive = true;
  void pending.then((next) => {
    if (alive) deliver(next);
  });
  return () => { alive = false; };
}

type PendingPhotos = Promise<readonly SanitizedShioriPhoto[]>;

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
  checked: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}>;

/** Unchecked by default: EXIF stripping stays on unless the user opts in (X6). */
function RetainExifOptIn({ label, checked, onChange }: RetainExifOptInProps) {
  return (
    <label className="shiori-generator__exif">
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}
