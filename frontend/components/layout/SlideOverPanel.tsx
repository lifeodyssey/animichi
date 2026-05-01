"use client";

import { useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface SlideOverPanelProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  loading?: boolean;
}

export function SlideOverPanel({ open, onClose, children, loading }: SlideOverPanelProps) {
  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, handleEsc]);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={onClose}
        />
      )}
      {/* Panel */}
      <div
        className={cn("fixed top-0 right-0 z-50 h-full w-[520px] max-w-[90vw] bg-background shadow-xl border-l border-border transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 rounded-full bg-background/80 p-2 shadow hover:bg-background transition"
          style={{ transitionDuration: "var(--duration-fast)" }}
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
        <div className="h-full overflow-y-auto p-6 pt-14">
          {loading ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            children
          )}
        </div>
      </div>
    </>
  );
}
