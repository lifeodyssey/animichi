"use client";

import { useState } from "react";
import { useDict } from "../../lib/i18n-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  // Derive origin from defaultOrigin prop; user can override via input.
  // Using a ref to track the previous default avoids calling setState in an effect.
  const [origin, setOrigin] = useState(defaultOrigin);
  const [prevDefault, setPrevDefault] = useState(defaultOrigin);
  if (defaultOrigin !== prevDefault) {
    setPrevDefault(defaultOrigin);
    setOrigin(defaultOrigin);
  }

  const handleRoute = () => {
    if (disabled || count === 0) return;
    onRoute(origin);
  };

  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-card px-5 py-2.5">
      <span className="shrink-0 text-xs font-medium text-primary">
        {t.count.replace("{count}", String(count))}
      </span>
      <Input shadow
        value={origin}
        onChange={(event) => setOrigin(event.target.value)}
        aria-label={t.placeholder}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            handleRoute();
          }
        }}
        placeholder={t.placeholder}
        size="small"
        className="min-w-0 flex-1"
        disabled={disabled}
      />
      <Button
        type="primary"
        size="small"
        onClick={handleRoute}
        disabled={disabled || count === 0}
      >
        {t.route}
      </Button>
      <Button
        type="link"
        size="small"
        onClick={onClear}
        disabled={disabled}
      >
        {t.clear}
      </Button>
    </div>
  );
}
