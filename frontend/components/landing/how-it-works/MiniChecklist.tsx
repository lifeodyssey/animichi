import { cn } from "@/lib/utils";

const ITEMS = ["須賀神社 階段", "四ツ谷駅", "新宿御苑"];

/** Stamped-checklist preview for the "checklist" step. */
export default function MiniChecklist() {
  return (
    <div className="flex flex-col gap-1.5 rounded-[12px] border border-border bg-background p-2.5">
      {ITEMS.map((s, i) => (
        <span key={s} className="flex items-center gap-2 text-[11px] text-fg">
          <span
            className={cn(
              "flex size-3.5 items-center justify-center rounded-[4px]",
              i < 2 ? "bg-primary text-primary-foreground" : "border border-border",
            )}
          >
            {i < 2 ? (
              <svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true">
                <path
                  d="M2 6l2.5 2.5L10 3"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : null}
          </span>
          {s}
        </span>
      ))}
    </div>
  );
}
