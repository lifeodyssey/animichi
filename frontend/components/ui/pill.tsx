"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pillVariants = cva("inline-flex items-center", {
  variants: {
    variant: {
      /** Quiet "log in only when…" hint chip on a section. */
      hint: "gap-2 rounded-[50px] border border-border bg-background px-4 py-2 text-[12px] font-medium text-muted-foreground",
      /** Frosted corner badge floated over a photo (Anime / Real). */
      corner: "gap-1.5 rounded-[50px] bg-card/95 px-2.5 py-1 text-[11px] font-bold text-fg shadow-sm backdrop-blur-sm",
      /** Small metadata tag (route attributes). */
      tag: "gap-1 rounded-[10px] border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground",
    },
  },
  defaultVariants: { variant: "hint" },
});

export interface PillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pillVariants> {}

/**
 * Pill — a non-interactive labelled badge in three journal registers: a `hint`
 * row chip, a frosted `corner` label for photos, and a small metadata `tag`.
 * Presentational only (a styled <span>); compose any leading icon/dot as children.
 */
export function Pill({ className, variant, children, ...props }: PillProps) {
  return (
    <span className={cn(pillVariants({ variant }), className)} {...props}>
      {children}
    </span>
  );
}
