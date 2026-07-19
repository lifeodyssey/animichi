import type { ReactNode } from "react";
import type { TimedItinerary } from "@seichijunrei/contract";
import type { ShioriLayout } from "../layoutSelector";
import type { ShioriMeta } from "../types";
import { shioriTimeWindow } from "../timeWindow";

type ShioriFrameProps = Readonly<{
  layout: ShioriLayout;
  label: string;
  children: ReactNode;
}>;

export function ShioriFrame({ layout, label, children }: ShioriFrameProps) {
  return (
    <article className={`shiori-card shiori-card--${layout}`} aria-label={label}>
      {children}
    </article>
  );
}

type ShioriHeaderProps = Readonly<{ eyebrow: string; meta: ShioriMeta }>;

export function ShioriHeader({ eyebrow, meta }: ShioriHeaderProps) {
  return (
    <header className="shiori-head">
      <p className="shiori-head__eyebrow">{eyebrow}</p>
      <h3 className="shiori-head__title">{meta.routeTitle}</h3>
      <p className="shiori-head__sub">{`${meta.animeTitle} · ${meta.dateLabel}`}</p>
    </header>
  );
}

export function ShioriTimeWindow({ itinerary }: Readonly<{ itinerary: TimedItinerary }>) {
  const window = shioriTimeWindow(itinerary);
  if (!window) return null;
  return <p className="shiori-window">{window}</p>;
}
