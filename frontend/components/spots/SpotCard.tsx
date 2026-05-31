"use client";

import { useState } from "react";
import type { PilgrimagePoint } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import { cn } from "../../lib/utils";

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
  const { spot_list: t } = useDict();
  if (episode == null || episode <= 0) return null;
  return (
    <span className="ep-badge absolute left-2 top-2 rounded-[5px] px-2 py-0.5 text-xs font-semibold tracking-wide text-white">
      {t.ep_badge.replace("{ep}", String(episode))}
    </span>
  );
}

function Thumbnail({ url, name }: { url: string | null; name: string }) {
  const { spot_list: t } = useDict();
  const [broken, setBroken] = useState(false);

  if (!url || broken) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted text-xs text-muted-foreground">
        {t.photo_missing}
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={name}
      width={320}
      height={200}
      loading="lazy"
      className="h-full w-full object-cover"
      onError={() => setBroken(true)}
    />
  );
}

export default function SpotCard(props: SpotCardProps) {
  const { point, mode } = props;

  const content = (
    <>
      <div className="relative aspect-[16/10] overflow-hidden">
        <Thumbnail url={point.screenshot_url} name={point.name} />
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
          "cursor-pointer overflow-hidden rounded-xl border-2 bg-background shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]",
          props.selected ? "border-primary" : "border-border",
        )}
      >
        {content}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border-2 border-border bg-background shadow-[var(--shadow-card)]">
      {content}
    </div>
  );
}
