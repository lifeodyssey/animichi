"use client";

import { useCallback, useRef, useState } from "react";

interface ImageCompareProps {
  leftSrc: string;
  rightSrc: string;
  leftAlt?: string;
  rightAlt?: string;
  leftLabel?: string;
  rightLabel?: string;
  initialPosition?: number;
  className?: string;
}

/**
 * Draggable image comparison slider.
 * Both images are full-size (stacked), a clip-path reveals left vs right.
 */
export function ImageCompare({
  leftSrc,
  rightSrc,
  leftAlt = "",
  rightAlt = "",
  leftLabel,
  rightLabel,
  initialPosition = 50,
  className,
}: ImageCompareProps) {
  const [position, setPosition] = useState(initialPosition);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

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
      className={className}
      style={{ position: "relative", overflow: "hidden", touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Right image (bottom layer, full size) */}
      <img
        src={rightSrc}
        alt={rightAlt}
        className="block h-full w-full object-cover"
        draggable={false}
      />

      {/* Left image (top layer, clipped) */}
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        <img
          src={leftSrc}
          alt={leftAlt}
          className="block h-full w-full object-cover"
          draggable={false}
        />
      </div>

      {/* Divider line */}
      <div
        className="pointer-events-none absolute inset-y-0 z-10 w-[3px] bg-white shadow-lg"
        style={{ left: `${position}%`, transform: "translateX(-50%)" }}
      />

      {/* Drag handle */}
      <div
        className="absolute top-1/2 z-20 flex size-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border-2 border-white bg-white/95 shadow-lg"
        style={{ left: `${position}%` }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M5 3L2 8L5 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/60" />
          <path d="M11 3L14 8L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/60" />
        </svg>
      </div>

      {/* Labels */}
      {leftLabel && (
        <div className="absolute bottom-3 left-3 z-10 rounded-md bg-primary px-2.5 py-1 text-[10px] font-bold text-white shadow-sm">
          {leftLabel}
        </div>
      )}
      {rightLabel && (
        <div className="absolute bottom-3 right-3 z-10 rounded-md bg-[var(--color-cta)] px-2.5 py-1 text-[10px] font-bold text-[var(--color-cta-fg)] shadow-sm">
          {rightLabel}
        </div>
      )}
    </div>
  );
}
