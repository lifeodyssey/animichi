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
import { Button } from "../ui/button";

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
          className="flex w-full items-center justify-between rounded-lg px-5 py-4 text-left font-display text-base font-semibold text-fg-heading transition-colors hover:bg-card hover:no-underline sm:text-lg"
        >
          <span className="flex items-center gap-3">
            {thumb && (
              <span className="inline-block h-8 w-8 shrink-0 overflow-hidden rounded-lg">
                <img
                  src={thumb}
                  alt=""
                  width={32}
                  height={32}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  onError={handleImageError}
                />
              </span>
            )}
            {title}
          </span>
          <span className="ml-auto mr-3 shrink-0 rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {spotsCountLabel ? spotsCountLabel.replace("{count}", String(count)) : `${count} spots`}
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <div className="grid grid-cols-1 gap-4 px-2 pb-5 pt-1 sm:grid-cols-2 lg:grid-cols-3">
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
            <div className="mx-2 mb-4">
              <Button
                type="dashed"
                size="middle"
                onClick={() => setShowAll(true)}
                className="w-full"
              >
                {showAllLabel
                  ? showAllLabel.replace("{count}", String(count))
                  : `Show all ${count} spots`}
              </Button>
            </div>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
