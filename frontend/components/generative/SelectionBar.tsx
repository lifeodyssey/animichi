"use client";

import { useEffect, useState } from "react";
import { useDict } from "../../lib/i18n-context";

interface SelectionBarProps {
  count: number;
  defaultOrigin: string;
  onRoute: (origin: string) => void;
  onClear: () => void;
  disabled?: boolean;
}

export default function SelectionBar({
  count,
  defaultOrigin,
  onRoute,
  onClear,
  disabled = false,
}: SelectionBarProps) {
  const { selection: t } = useDict();
  const [origin, setOrigin] = useState(defaultOrigin);

  useEffect(() => {
    setOrigin(defaultOrigin);
  }, [defaultOrigin]);

  const handleRoute = () => {
    if (disabled || count === 0) return;
    onRoute(origin);
  };

  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-card px-5 py-2.5">
      <span className="shrink-0 text-xs font-medium text-primary">
        {t.count.replace("{count}", String(count))}
      </span>
      <input
        value={origin}
        onChange={(event) => setOrigin(event.target.value)}
        aria-label={t.placeholder}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            handleRoute();
          }
        }}
        placeholder={t.placeholder}
        className="min-w-0 flex-1 rounded-sm bg-muted px-2 py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
      />
      <button
        type="button"
        onClick={handleRoute}
        className="shrink-0 rounded-sm bg-primary px-3 py-1 text-xs font-medium text-primary-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        style={{ transitionDuration: "var(--duration-fast)" }}
        disabled={disabled || count === 0}
      >
        {t.route}
      </button>
      <button
        type="button"
        onClick={onClear}
        className="shrink-0 text-xs text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        style={{ transitionDuration: "var(--duration-fast)" }}
        disabled={disabled}
      >
        {t.clear}
      </button>
    </div>
  );
}
