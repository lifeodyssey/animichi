import { cn } from "@/lib/utils";

interface LocationBadgeProps {
  /** Place name, e.g. 新宿 / 宇治. */
  name: string;
  className?: string;
}

/**
 * A small enamel place-tag pinned to route artwork. Cream chip, warm border,
 * a teal locator dot. Reads as a luggage destination label, not a generic chip.
 */
export default function LocationBadge({ name, className }: LocationBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[10px] border border-border/80",
        "bg-card/95 px-2.5 py-1 text-[12px] font-bold text-fg shadow-sm backdrop-blur-sm",
        className,
      )}
    >
      <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
        <circle cx="4.5" cy="4.5" r="4.5" fill="var(--color-primary)" />
      </svg>
      {name}
    </span>
  );
}
