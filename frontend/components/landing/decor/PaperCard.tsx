import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PaperCardProps {
  children: ReactNode;
  /** Turned top-right corner. */
  fold?: boolean;
  /** Slight tilt, degrees. */
  rotate?: number;
  className?: string;
}

/**
 * A page torn from a travel journal: warm parchment grain, soft turned corner,
 * a hand-set tilt. The base surface for hero copy, notebook entries, and banners.
 */
export default function PaperCard({
  children,
  fold = true,
  rotate = 0,
  className,
}: PaperCardProps) {
  return (
    <div
      className={cn(
        "paper-surface relative rounded-[20px]",
        fold && "paper-fold",
        className,
      )}
      style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}
    >
      {children}
    </div>
  );
}
