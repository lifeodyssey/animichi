"use client";

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { TimedItinerary, TimedStop, TransitLeg } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIRTUALIZE_THRESHOLD = 20;
// Stop rows with photo: ~104px. Without photo: ~60px. Use the photo height as
// the estimate — the virtualizer corrects on measure; over-estimating is safer
// than under-estimating (avoids scroll bar jump).
const STOP_ROW_HEIGHT = 104;
const WALK_ROW_HEIGHT = 48;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findLeg(
  legs: TransitLeg[],
  from: TimedStop,
  to: TimedStop,
): TransitLeg | undefined {
  return legs.find(
    (l) => l.from_id === from.cluster_id && l.to_id === to.cluster_id,
  );
}

function fmtDist(m: number): string {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

function fmtSeq(n: number): string {
  return String(n).padStart(2, "0");
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface StopDotProps {
  isActive: boolean;
  isFirst: boolean;
}

function StopDot({ isActive, isFirst }: StopDotProps) {
  // Sizes: active=14, first=16, default=12 — no Tailwind equivalent for runtime px
  const size = isActive ? 14 : isFirst ? 16 : 12;
  return (
    <div
      className={cn(
        "shrink-0 rounded-full",
        isActive ? "bg-brand" : "bg-primary",
      )}
      style={{ width: size, height: size, zIndex: 1 }}
    />
  );
}

interface StopRowProps {
  stop: TimedStop;
  seq: number;
  isFirst: boolean;
  isLast: boolean;
  isActive: boolean;
  photoCountLabel: string;
  onStopClick?: (id: string) => void;
}

function StopRow({
  stop,
  seq,
  isFirst,
  isLast,
  isActive,
  photoCountLabel,
  onStopClick,
}: StopRowProps) {
  const photoUrl = stop.points[0]?.screenshot_url ?? null;
  const episode = stop.points[0]?.episode;

  return (
    <button
      type="button"
      data-active={isActive}
      className={cn(
        "flex w-full cursor-pointer gap-[14px] rounded-md pb-0.5 text-left transition-colors duration-150 hover:bg-card",
        isActive && "bg-brand-soft",
      )}
      onClick={() => onStopClick?.(stop.cluster_id)}
      aria-current={isActive ? "step" : undefined}
    >
      {/* Time column (56px, right-aligned) — shows sequence number + arrive time */}
      <div className="w-14 shrink-0 pt-[2px] text-right tabular-nums">
        <div className="text-xs font-medium text-muted-foreground">
          {fmtSeq(seq)}
        </div>
        <div className="text-sm font-semibold text-foreground">
          {stop.arrive}
        </div>
        <div className="text-xs text-muted-foreground">
          {stop.dwell_minutes} 分
        </div>
      </div>

      {/* Dot + rail column (24px) */}
      <div className="flex w-6 shrink-0 flex-col items-center">
        <StopDot isActive={isActive} isFirst={isFirst} />
        {!isLast && <div className="w-0.5 flex-1 bg-border" />}
      </div>

      {/* Content column — photo absence never shifts the dot or time */}
      <div className="min-w-0 flex-1 pb-1.5">
        <div className="mb-0.5 font-display text-sm font-semibold text-foreground">
          {stop.name}
        </div>
        <div className="mb-1.5 text-xs text-muted-foreground">
          {episode != null ? `EP ${episode} · ` : ""}
          {photoCountLabel}
        </div>
        {photoUrl && (
          <img
            src={photoUrl}
            alt={stop.name}
            width={72}
            height={48}
            className="h-12 w-[72px] rounded-sm bg-muted object-cover"
            loading="lazy"
          />
        )}
      </div>
    </button>
  );
}

interface WalkRowProps {
  leg: TransitLeg;
}

function WalkRow({ leg }: WalkRowProps) {
  return (
    <div className="flex gap-[14px] py-2">
      <div className="w-14 shrink-0" />
      <div className="flex w-6 shrink-0 justify-center">
        {/* Dashed line — CSS class defined in globals.css to avoid inline oklch */}
        <div className="timeline-walk-dash w-[3px] min-h-7" />
      </div>
      <div className="inline-flex items-center gap-1 rounded-md bg-walk-bg px-3.5 py-1.5 text-sm font-semibold text-walk-fg">
        <span className="text-base" aria-hidden>🚶</span>
        {leg.duration_minutes} 分 · {fmtDist(leg.distance_m)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Types for virtual list items
// ---------------------------------------------------------------------------

type TimelineItem =
  | { kind: "stop"; stop: TimedStop; seq: number; isFirst: boolean; isLast: boolean }
  | { kind: "walk"; leg: TransitLeg };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RouteTimelineProps {
  itinerary: TimedItinerary;
  activeStopId?: string;
  onStopClick?: (stopId: string) => void;
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyItinerary({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center px-4 py-8 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Virtualized list (20+ stops)
// Requires the parent to provide a constrained height (e.g. flex-1 overflow-hidden).
// ---------------------------------------------------------------------------

interface VirtualTimelineProps {
  items: TimelineItem[];
  activeStopId?: string;
  photoCountFn: (count: number) => string;
  onStopClick?: (id: string) => void;
}

function VirtualTimeline({
  items,
  activeStopId,
  photoCountFn,
  onStopClick,
}: VirtualTimelineProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) =>
      items[i]?.kind === "walk" ? WALK_ROW_HEIGHT : STOP_ROW_HEIGHT,
    overscan: 4,
  });

  return (
    <div ref={parentRef} className="overflow-y-auto" style={{ height: "100%", maxHeight: "100%" }}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vItem) => {
          const item = items[vItem.index];
          return (
            <div
              key={vItem.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vItem.start}px)`,
              }}
            >
              {renderItem(item, activeStopId, photoCountFn, onStopClick)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Render item helper
// ---------------------------------------------------------------------------

function renderItem(
  item: TimelineItem,
  activeStopId: string | undefined,
  photoCountFn: (count: number) => string,
  onStopClick?: (id: string) => void,
): React.ReactNode {
  if (item.kind === "walk") {
    return <WalkRow leg={item.leg} />;
  }
  return (
    <StopRow
      stop={item.stop}
      seq={item.seq}
      isFirst={item.isFirst}
      isLast={item.isLast}
      isActive={item.stop.cluster_id === activeStopId}
      photoCountLabel={photoCountFn(item.stop.photo_count)}
      onStopClick={onStopClick}
    />
  );
}

// ---------------------------------------------------------------------------
// RouteTimeline
// ---------------------------------------------------------------------------

export default function RouteTimeline({
  itinerary,
  activeStopId,
  onStopClick,
}: RouteTimelineProps) {
  const { route: rt } = useDict();
  const { stops, legs } = itinerary;

  if (stops.length === 0) {
    return <EmptyItinerary message={rt.timeline_empty} />;
  }

  const photoCountFn = (count: number) =>
    rt.timeline_spots.replace("{count}", String(count));

  const items: TimelineItem[] = [];
  let seq = 0;
  stops.forEach((stop, idx) => {
    seq += 1;
    items.push({
      kind: "stop",
      stop,
      seq,
      isFirst: idx === 0,
      isLast: idx === stops.length - 1,
    });
    const nextStop = stops[idx + 1];
    if (!nextStop) return;
    const leg = findLeg(legs, stop, nextStop);
    if (leg) {
      items.push({ kind: "walk", leg });
    }
  });

  if (stops.length >= VIRTUALIZE_THRESHOLD) {
    return (
      <VirtualTimeline
        items={items}
        activeStopId={activeStopId}
        photoCountFn={photoCountFn}
        onStopClick={onStopClick}
      />
    );
  }

  return (
    <div className="flex flex-col">
      {items.map((item) => {
        const key =
          item.kind === "stop"
            ? item.stop.cluster_id
            : `walk-${item.leg.from_id}-${item.leg.to_id}`;
        return (
          <div key={key}>
            {renderItem(item, activeStopId, photoCountFn, onStopClick)}
          </div>
        );
      })}
    </div>
  );
}
