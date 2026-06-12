"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const exploreButtonVariants = cva(
  "btn-explore inline-flex items-center justify-center gap-2 font-bold",
  {
    variants: {
      size: {
        sm: "px-5 py-2 text-[13px]",
        md: "px-6 py-2.5 text-[14px]",
        lg: "px-6 py-3 text-[15px]",
        xl: "px-7 py-3 text-[19px]",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export interface ExploreButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof exploreButtonVariants> {
  /** Render as the child element (e.g. a Next.js <Link>) via Radix Slot. */
  asChild?: boolean;
}

/**
 * ExploreButton — the brand pumpkin-orange CTA ("Start Exploring", "Save my route").
 *
 * The orange `btn-explore` treatment is bespoke (animal-island-ui's Button is teal,
 * with no orange variant), so this lives as an app-owned design-system control built
 * on the shadcn pattern — `class-variance-authority` for sizes + Radix `Slot` for
 * `asChild` polymorphism — instead of a raw <button> repeated across pages.
 */
export function ExploreButton({
  className,
  size,
  asChild = false,
  type,
  ...props
}: ExploreButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(exploreButtonVariants({ size }), className)}
      {...(asChild ? {} : { type: type ?? "button" })}
      {...props}
    />
  );
}
