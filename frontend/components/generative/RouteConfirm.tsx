"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import type { PilgrimagePoint } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import { haversineKm } from "../../lib/geo";
import { SortableItem } from "./RouteConfirmItem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RouteConfirmProps {
  points: PilgrimagePoint[];
  defaultOrigin: string;
  onConfirm: (orderedIds: string[], origin: string) => void;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// RouteConfirm
// ---------------------------------------------------------------------------

export default function RouteConfirm({
  points,
  defaultOrigin,
  onConfirm,
  onBack,
}: RouteConfirmProps) {
  const { route_confirm: t } = useDict();
  const [orderedPoints, setOrderedPoints] = useState<PilgrimagePoint[]>(points);
  const [origin, setOrigin] = useState(defaultOrigin);
  const [lastRemoved, setLastRemoved] = useState<{ point: PilgrimagePoint; index: number } | null>(null);

  useEffect(() => {
    if (!lastRemoved) return;
    const timer = setTimeout(() => setLastRemoved(null), 5000);
    return () => clearTimeout(timer);
  }, [lastRemoved]);

  const canConfirm = orderedPoints.length >= 2;

  const totalDistanceKm = useMemo(() => {
    let total = 0;
    for (let i = 1; i < orderedPoints.length; i++) {
      total += haversineKm(
        orderedPoints[i - 1].latitude,
        orderedPoints[i - 1].longitude,
        orderedPoints[i].latitude,
        orderedPoints[i].longitude,
      );
    }
    return total;
  }, [orderedPoints]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrderedPoints((prev) => {
      const oldIndex = prev.findIndex((p) => p.id === active.id);
      const newIndex = prev.findIndex((p) => p.id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  const handleRemove = useCallback((id: string) => {
    setOrderedPoints((prev) => {
      const index = prev.findIndex((p) => p.id === id);
      if (index === -1) return prev;
      setLastRemoved({ point: prev[index], index });
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (!canConfirm) return;
    onConfirm(
      orderedPoints.map((p) => p.id),
      origin,
    );
  }, [canConfirm, onConfirm, orderedPoints, origin]);

  const itemIds = useMemo(
    () => orderedPoints.map((p) => p.id),
    [orderedPoints],
  );

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Fix 8: grip hover animation */}
      <style>{`
        .group:hover .grip-handle > div { color: rgba(241, 143, 67, 0.6) !important; }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center border-b border-border px-4 py-3">
        <Button
          variant="link"
          size="sm"
          onClick={onBack}
          className="h-[44px] gap-1"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {t.back}
        </Button>
        <span
          className="flex-1 text-center text-base font-semibold text-foreground font-display"
        >
          {t.title}
        </span>
        {/* Spacer for centering */}
        <div className="w-[72px]" />
      </div>

      {/* ── Departure input ─────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border px-5 py-4">
        <label className="mb-1 block text-xs text-muted-foreground">
          {t.departure_label}
        </label>
        <Input
          type="text"
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          placeholder={t.departure_placeholder}
        />
      </div>

      {/* ── Sortable list ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <DndContext
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={itemIds}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-2">
              {orderedPoints.map((point, index) => (
                <SortableItem
                  key={point.id}
                  point={point}
                  index={index}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {orderedPoints.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t.empty}
          </p>
        )}

        {orderedPoints.length === 1 && (
          <p className="px-1 pt-2 text-xs text-warning-fg">
            {t.min_points_warning}
          </p>
        )}
      </div>

      {/* ── Undo toast ───────────────────────────────────────────────── */}
      {lastRemoved && (
        <div className="shrink-0 px-4 pb-2" role="status" aria-live="polite">
          <div
            className="flex items-center justify-between rounded-md px-4 py-2"
            style={{ background: "var(--color-fg)", color: "var(--color-bg)", fontSize: 13 }}
          >
            <span>{t.removed.replace("{name}", lastRemoved.point.name_cn || lastRemoved.point.name)}</span>
            <button
              type="button"
              onClick={() => {
                setOrderedPoints(prev => {
                  const next = [...prev];
                  next.splice(lastRemoved.index, 0, lastRemoved.point);
                  return next;
                });
                setLastRemoved(null);
              }}
              style={{ fontWeight: 600, marginLeft: 12, color: "var(--color-secondary)" }}
            >
              {t.undo}
            </button>
          </div>
        </div>
      )}

      {/* ── Summary + confirm — Fix 9 & 10 ──────────────────────────── */}
      <div className="shrink-0 border-t border-border bg-card px-4 py-4">
        <div className="mb-3 text-center">
          <div
            className="font-display text-foreground"
            style={{ fontSize: 14 }}
          >
            {t.summary.replace("{count}", String(orderedPoints.length))}
          </div>
          <div
            className="mt-0.5 text-muted-foreground"
            style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}
          >
            {t.estimate
              .replace("{distance}", totalDistanceKm.toFixed(1))
              .replace("{time}", String(Math.max(1, Math.round((totalDistanceKm / 4) * 60))))}
          </div>
        </div>
        <Button
          variant="primary"
          onClick={handleConfirm}
          disabled={!canConfirm}
          className="w-full"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="10" />
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
          </svg>
          {t.start}
        </Button>
      </div>
    </div>
  );
}
