import { MapPin } from "lucide-react";

export interface CaptionRowProps {
  /** Place name shown as the heading line (e.g. "Fushimi Inari Taisha"). */
  name: string;
  /** Area / region shown under the place name (e.g. "Kyoto, Japan"). */
  area: string;
}

/**
 * CaptionRow — the place caption under the scene card: a tinted pin badge beside
 * a two-line place name + area. Presentational only.
 */
export default function CaptionRow({ name, area }: CaptionRowProps) {
  return (
    <div className="flex items-center gap-2.5 px-2 pb-1 pt-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/12">
        <MapPin size={15} className="text-primary" aria-hidden="true" />
      </span>
      <span className="leading-tight">
        <span className="block font-display text-[15px] font-bold text-fg-heading">{name}</span>
        <span className="block text-[12px] font-medium text-muted-foreground">{area}</span>
      </span>
    </div>
  );
}
