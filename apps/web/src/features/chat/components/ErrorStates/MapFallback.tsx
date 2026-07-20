import type { ChatDict } from "../../i18n";

type Props = Readonly<{ dict: ChatDict; lat?: number; lng?: number }>;

function mapAppUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${String(lat)},${String(lng)}`;
}

const DOODLE_TRAIL = "M4 34 C14 22 24 30 32 20 C40 10 52 16 60 8";

function DoodleTrail() {
  return (
    <path d={DOODLE_TRAIL} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
  );
}

function MapDoodle() {
  return (
    <svg className="chat-map-fallback__doodle" viewBox="0 0 64 40" aria-hidden="true">
      <DoodleTrail />
      <circle cx="32" cy="20" r="4" fill="currentColor" />
      <circle cx="60" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function MapAppLink({ dict, lat, lng }: Props) {
  if (lat === undefined || lng === undefined) return null;
  return (
    <a className="chat-map-fallback__open" href={mapAppUrl(lat, lng)} target="_blank" rel="noreferrer">
      {dict.errorStates.d7Open}
    </a>
  );
}

/** D7: static-map failure degrades to a drawn doodle, never a broken image. */
export function MapFallback(props: Props) {
  return (
    <figure className="chat-map-fallback">
      <MapDoodle />
      <figcaption>{props.dict.errorStates.d7Message}</figcaption>
      <MapAppLink {...props} />
    </figure>
  );
}
