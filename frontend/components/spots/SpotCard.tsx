"use client";

import type { PilgrimagePoint } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import { cn } from "../../lib/utils";
import { handleImageError } from "../auth/LandingData";

interface BrowseProps {
  point: PilgrimagePoint;
  mode: "browse";
  selected?: never;
  onToggle?: never;
}

interface SelectProps {
  point: PilgrimagePoint;
  mode: "select";
  selected: boolean;
  onToggle: (id: string) => void;
}

type SpotCardProps = BrowseProps | SelectProps;

function EpBadge({ episode }: { episode: number | null }) {
  const { grid: t } = useDict();
  if (episode == null || episode <= 0) return null;
  return (
    <span className="absolute left-2 top-2 rounded-[5px] px-2 py-0.5 text-xs font-semibold tracking-wide text-white" style={{ background: "var(--color-overlay-soft)", backdropFilter: "blur(4px)" }}>
      {t.episode.replace("{ep}", String(episode))}
    </span>
  );
}

export default function SpotCard(props: SpotCardProps) {
  const { point, mode } = props;

  const content = (
    <>
      <div className="relative aspect-[16/10] overflow-hidden">
        {point.screenshot_url ? (
          <img
            src={point.screenshot_url}
            alt={point.name}
            width={320}
            height={200}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={handleImageError}
          />
        ) : (
          <div className="h-full w-full bg-muted" />
        )}
        <EpBadge episode={point.episode} />
      </div>
      <div className="px-3 py-3">
        <div className="truncate text-sm font-medium text-foreground">
          {point.name}
        </div>
      </div>
    </>
  );

  if (mode === "select") {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-pressed={props.selected}
        onClick={() => props.onToggle(point.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            props.onToggle(point.id);
          }
        }}
        className={cn(
          "cursor-pointer overflow-hidden rounded-xl border-2 bg-background transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg",
          props.selected ? "border-primary" : "border-transparent",
        )}
      >
        {content}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      {content}
    </div>
  );
}
