"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BeforeAfterProps {
  leftSrc: string;
  rightSrc: string;
  leftAlt?: string;
  rightAlt?: string;
  leftLabel?: string;
  rightLabel?: string;
  draggable?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Image side sub-component
// ---------------------------------------------------------------------------

function ImageSide({
  src,
  alt = "",
  testId,
  placeholderTestId,
  children,
}: {
  src: string;
  alt?: string;
  testId: string;
  placeholderTestId: string;
  children?: React.ReactNode;
}) {
  const [errored, setErrored] = useState(false);

  const handleError = useCallback(() => setErrored(true), []);

  if (!src || errored) {
    return (
      <div
        data-testid={placeholderTestId}
        role="img"
        aria-label={alt || "Image unavailable"}
        className="flex h-full w-full items-center justify-center bg-muted"
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="text-muted-foreground"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      </div>
    );
  }

  return (
    <>
      <img
        data-testid={testId}
        src={src}
        alt={alt}
        className="block h-full w-full object-cover"
        draggable={false}
        onError={handleError}
      />
      {children}
    </>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

function Badge({
  label,
  side,
}: {
  label: string;
  side: "left" | "right";
}) {
  const base =
    "absolute bottom-3 z-10 rounded-[12px] px-2.5 py-1 text-[10px] font-bold shadow-sm";
  const leftClass = "left-3 bg-primary text-primary-foreground";
  const rightClass = "right-3 bg-cta text-cta-foreground";

  return (
    <div className={cn(base, side === "left" ? leftClass : rightClass)}>
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drag handle (shared with ImageCompare, extracted here)
// ---------------------------------------------------------------------------

function DragHandle({ position, onKeyDown }: { position: number; onKeyDown?: (e: React.KeyboardEvent) => void }) {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-y-0 z-10 w-[3px] bg-background shadow-lg"
        style={{ left: `${position}%`, transform: "translateX(-50%)" }}
      />
      <div
        role="slider"
        tabIndex={0}
        aria-label="Compare anime and real photo"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position)}
        className="absolute top-1/2 z-20 flex size-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border-2 border-background bg-card/95 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffcc00]"
        style={{ left: `${position}%` }}
        onKeyDown={onKeyDown}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M5 3L2 8L5 13"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-foreground/60"
          />
          <path
            d="M11 3L14 8L11 13"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-foreground/60"
          />
        </svg>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Static split layout
// ---------------------------------------------------------------------------

function StaticSplit({
  leftSrc,
  rightSrc,
  leftAlt,
  rightAlt,
  leftLabel,
  rightLabel,
}: Pick<
  BeforeAfterProps,
  "leftSrc" | "rightSrc" | "leftAlt" | "rightAlt" | "leftLabel" | "rightLabel"
>) {
  return (
    <div className="flex h-full w-full">
      <div className="relative h-full w-1/2 overflow-hidden">
        <ImageSide
          src={leftSrc}
          alt={leftAlt}
          testId="left-img"
          placeholderTestId="left-placeholder"
        >
          {leftLabel && <Badge label={leftLabel} side="left" />}
        </ImageSide>
      </div>

      <div className="relative h-full w-1/2 overflow-hidden border-l border-white/30">
        <ImageSide
          src={rightSrc}
          alt={rightAlt}
          testId="right-img"
          placeholderTestId="real-placeholder"
        >
          {rightLabel && <Badge label={rightLabel} side="right" />}
        </ImageSide>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draggable layout (reuses DragHandle + ImageSide)
// ---------------------------------------------------------------------------

function DraggableSplit({
  leftSrc,
  rightSrc,
  leftAlt,
  rightAlt,
  leftLabel,
  rightLabel,
}: Pick<
  BeforeAfterProps,
  "leftSrc" | "rightSrc" | "leftAlt" | "rightAlt" | "leftLabel" | "rightLabel"
>) {
  const [position, setPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPosition((p) => Math.max(0, p - step));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPosition((p) => Math.min(100, p + step));
    }
  }, []);

  const updatePosition = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    setPosition((x / rect.width) * 100);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      updatePosition(e.clientX);
    },
    [updatePosition],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      updatePosition(e.clientX);
    },
    [updatePosition],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Right (real) — bottom layer */}
      <div className="absolute inset-0">
        <ImageSide
          src={rightSrc}
          alt={rightAlt}
          testId="right-img"
          placeholderTestId="real-placeholder"
        />
      </div>

      {/* Left (anime) — top layer, clipped */}
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        <ImageSide
          src={leftSrc}
          alt={leftAlt}
          testId="left-img"
          placeholderTestId="left-placeholder"
        />
      </div>

      <DragHandle position={position} onKeyDown={onKeyDown} />

      {leftLabel && <Badge label={leftLabel} side="left" />}
      {rightLabel && <Badge label={rightLabel} side="right" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BeforeAfter — public component
// ---------------------------------------------------------------------------

export default function BeforeAfter({
  leftSrc,
  rightSrc,
  leftAlt = "",
  rightAlt = "",
  leftLabel,
  rightLabel,
  draggable = false,
  className,
}: BeforeAfterProps) {
  return (
    <div
      className={cn(
        "relative min-h-[200px] w-full overflow-hidden rounded-[18px] border border-border bg-card",
        "aspect-video",
        className,
      )}
    >
      {draggable ? (
        <DraggableSplit
          leftSrc={leftSrc}
          rightSrc={rightSrc}
          leftAlt={leftAlt}
          rightAlt={rightAlt}
          leftLabel={leftLabel}
          rightLabel={rightLabel}
        />
      ) : (
        <StaticSplit
          leftSrc={leftSrc}
          rightSrc={rightSrc}
          leftAlt={leftAlt}
          rightAlt={rightAlt}
          leftLabel={leftLabel}
          rightLabel={rightLabel}
        />
      )}
    </div>
  );
}
