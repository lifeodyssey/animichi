import type { ChatDict } from "../../i18n";

type Props = Readonly<{ dict: ChatDict; lat?: number; lng?: number }>;
const LINK = "chat-map-fallback__open animal-btn animal-btn-text animal-btn-middle [min-height:44px]! [height:auto]! [padding:8px_0]! [font-size:14px]! [line-height:1.5]! [white-space:normal]! [text-align:left] [--animal-text-color:var(--color-primary-strong)] focus-visible:outline-primary-strong motion-reduce:[transition:none]!";

function mapAppUrl(lat: number | undefined, lng: number | undefined): string | undefined {
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  return `https://www.google.com/maps/search/?api=1&query=${String(lat)},${String(lng)}`;
}

function MapMark() {
  return <span className="[display:grid] size-9 shrink-0 place-items-center rounded-full bg-paper text-muted-fg" aria-hidden="true">
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6ZM9 3v15M15 6v15" /></svg>
  </span>;
}

function MapAppLink({ dict, lat, lng }: Props) {
  const href = mapAppUrl(lat, lng);
  if (!href) return null;
  return <a className={LINK} href={href} target="_blank" rel="noopener noreferrer">{dict.errorStates.d7Open}<svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M7 4H4v12h12v-3M11 4h5v5M16 4l-8 8" /></svg></a>;
}

/** Missing basemap tiles never stand in for missing places or a verified route. */
export function MapFallback(props: Props) {
  return <figure className="chat-map-fallback m-0 grid min-w-0 grid-cols-[36px_minmax(0,1fr)] items-start gap-3 rounded-2xl bg-muted/50 p-4">
    <MapMark />
    <figcaption className="grid min-w-0 justify-items-start [overflow-wrap:anywhere]"><p className="pt-1 text-sm font-medium leading-6 text-fg" role="status">{props.dict.errorStates.d7Message}</p><MapAppLink {...props} /></figcaption>
  </figure>;
}
