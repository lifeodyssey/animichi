"use client";

import { useState } from "react";
import type { PilgrimagePoint } from "../../lib/types";
import { handleImageError } from "../auth/LandingData";
import SpotCard from "./SpotCard";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../ui/accordion";

const PREVIEW_COUNT = 6;

interface SpotGroupProps {
  title: string;
  count: number;
  points: PilgrimagePoint[];
  defaultOpen?: boolean;
  showAllLabel?: string;
  spotsCountLabel?: string;
  revealRef?: (el: HTMLElement | null) => void;
  selectedIds?: Set<string>;
  onToggle?: (id: string) => void;
}

function leadThumb(points: PilgrimagePoint[]): string | null {
  for (const p of points) {
    if (p.screenshot_url) return p.screenshot_url;
  }
  return null;
}

export default function SpotGroup({
  title,
  count,
  points,
  defaultOpen = false,
  showAllLabel,
  spotsCountLabel,
  revealRef,
  selectedIds,
  onToggle,
}: SpotGroupProps) {
  const [showAll, setShowAll] = useState(false);
  const [openItems, setOpenItems] = useState<string[]>(defaultOpen ? [title] : []);
  const isSelectMode = selectedIds !== undefined && onToggle !== undefined;

  const hasMore = points.length > PREVIEW_COUNT;
  const visiblePoints = showAll || !hasMore ? points : points.slice(0, PREVIEW_COUNT);
  const thumb = leadThumb(points);

  return (
    <Accordion value={openItems} onValueChange={setOpenItems}>
      <AccordionItem value={title} className="border-b border-border">
        <AccordionTrigger
          className="flex w-full items-center justify-between rounded-lg px-2 py-4 text-left text-base font-semibold text-foreground transition-colors hover:bg-card hover:no-underline font-display"
        >
          <span className="flex items-center gap-2.5">
            {thumb && (
              <span className="inline-block h-7 w-7 shrink-0 overflow-hidden rounded-[6px]">
                <img
                  src={thumb}
                  alt=""
                  width={28}
                  height={28}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  onError={handleImageError}
                />
              </span>
            )}
            {title}
          </span>
          <span className="ml-auto mr-2 text-sm font-normal text-muted-foreground">
            {spotsCountLabel ? spotsCountLabel.replace("{count}", String(count)) : `${count} spots`}
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <div className="grid grid-cols-1 gap-4 px-2 pb-4 sm:grid-cols-2 lg:grid-cols-3">
            {visiblePoints.map((point, i) => (
              <div
                key={point.id}
                ref={revealRef}
                className="seichi-reveal-pop"
                style={{ animationDelay: `${i * 0.04}s` }}
              >
                {isSelectMode ? (
                  <SpotCard
                    point={point}
                    mode="select"
                    selected={selectedIds.has(point.id)}
                    onToggle={onToggle}
                  />
                ) : (
                  <SpotCard point={point} mode="browse" />
                )}
              </div>
            ))}
          </div>
          {hasMore && !showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mx-2 mb-4 w-[calc(100%-16px)] rounded-lg border border-primary/30 bg-primary/5 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10 hover:text-foreground"
            >
              {showAllLabel
                ? showAllLabel.replace("{count}", String(count))
                : `Show all ${count} spots`}
            </button>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
