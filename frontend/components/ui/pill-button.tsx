"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pillButtonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[50px] border border-border font-bold text-fg shadow-3d-sm transition-transform hover:-translate-y-0.5",
  {
    variants: {
      surface: { background: "bg-background", card: "bg-card" },
      size: {
        sm: "px-4 py-2 text-[13px]",
        md: "px-5 py-2.5 text-[14px]",
        lg: "py-3 text-[13px]",
      },
    },
    defaultVariants: { surface: "background", size: "md" },
  },
);

export interface PillButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof pillButtonVariants> {
  /** Render as the child element (e.g. a Next.js <Link>) via Radix Slot. */
  asChild?: boolean;
}

/**
 * PillButton — the cream/brown 3D-bottom-shadow pill (secondary actions like
 * "Keep browsing", "View all"). The shadow-3d-sm + hover-lift treatment is
 * bespoke (animal-island-ui's Button is teal and doesn't express it), so this is
 * an app-owned design-system control on the shadcn pattern (cva + Radix Slot for
 * `asChild`, so it can wrap a <Link> without losing the pill).
 */
export function PillButton({
  className,
  surface,
  size,
  asChild = false,
  type,
  ...props
}: PillButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(pillButtonVariants({ surface, size }), className)}
      {...(asChild ? {} : { type: type ?? "button" })}
      {...props}
    />
  );
}
