"use client";

import { useDict } from "../../lib/i18n-context";

interface SpotListEmptyProps {
  onRetry?: () => void;
  onRefine?: () => void;
}

export function SpotListEmpty({ onRetry, onRefine }: SpotListEmptyProps) {
  const { spot_list: t } = useDict();

  return (
    <div
      data-testid="spot-list-empty"
      className="flex flex-col items-center gap-3 px-3 py-6 text-center"
    >
      <span className="text-2xl" role="img" aria-label="no results">
        🗺️
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold text-foreground">{t.empty_title}</p>
        <p className="text-[10px] text-muted-foreground">{t.empty_hint}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full border border-border bg-background px-3 py-1 text-[10px] font-medium text-foreground transition-colors hover:bg-muted"
          >
            {t.empty_retry}
          </button>
        )}
        {onRefine && (
          <button
            type="button"
            onClick={onRefine}
            className="rounded-full border border-border bg-background px-3 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            {t.empty_refine}
          </button>
        )}
      </div>
    </div>
  );
}
