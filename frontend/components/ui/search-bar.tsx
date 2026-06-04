"use client";

import { type Ref } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExploreButton } from "@/components/ui/explore-button";

export interface SearchBarProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  ctaLabel: string;
  className?: string;
  /** Forwarded to the inner field so a "/" page shortcut can focus it. */
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * SearchBar — the hero's combined search field: a leading search glyph, a flush
 * text field, and the pumpkin ExploreButton, all inside one shared pill.
 *
 * It intentionally hosts a bare <input> rather than the animal-island-ui Input:
 * the library Input renders its own bordered/pill wrapper, which would double up
 * the chrome and break the seamless flush-CTA seam. Encapsulating the field here
 * keeps pages free of scattered raw inputs — this composite IS the design-system
 * control for "search + CTA in one bar".
 */
export function SearchBar({
  value,
  onValueChange,
  onSubmit,
  placeholder,
  ctaLabel,
  className,
  inputRef,
}: SearchBarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-[50px] border border-border bg-background p-1.5 shadow-3d-sm",
        className,
      )}
    >
      <Search size={17} className="ml-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-keyshortcuts="/"
        className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
      {!value && (
        <kbd
          aria-hidden="true"
          className="mr-1 inline-flex h-6 select-none items-center rounded-[7px] border border-border bg-muted px-1.5 font-mono text-[12px] font-semibold leading-none text-muted-foreground max-sm:hidden"
        >
          /
        </kbd>
      )}
      <ExploreButton onClick={onSubmit} className="shrink-0">
        {ctaLabel}
      </ExploreButton>
    </div>
  );
}
