"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center",
    "whitespace-nowrap font-semibold tracking-[0.02em]",
    "rounded-[var(--r-pill)] border-2 border-transparent",
    "transition-all duration-[var(--duration-base)] ease-[var(--ease-animal)]",
    "outline-none select-none",
    "focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2",
    "disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: [
          "bg-card text-foreground border-card",
          "shadow-[0_5px_0_0_var(--color-3d-shadow)]",
          "hover:translate-y-[-1px] hover:shadow-[0_6px_0_0_var(--color-3d-shadow)]",
          "active:translate-y-[2px] active:shadow-[0_1px_0_0_var(--color-3d-shadow)]",
        ].join(" "),
        default: [
          "bg-background text-foreground border-border",
          "shadow-[0_5px_0_0_var(--color-3d-shadow)]",
          "hover:border-primary hover:text-primary",
          "hover:translate-y-[-1px] hover:shadow-[0_6px_0_0_var(--color-3d-shadow)]",
          "active:translate-y-[2px] active:shadow-[0_1px_0_0_var(--color-3d-shadow)]",
        ].join(" "),
        cta: [
          "bg-[var(--color-cta)] text-[var(--color-cta-fg)] border-[var(--color-cta)]",
          "shadow-[0_5px_0_0_var(--color-3d-shadow)]",
          "hover:bg-[var(--color-cta-hover)] hover:translate-y-[-1px] hover:shadow-[0_6px_0_0_var(--color-3d-shadow)]",
          "active:translate-y-[2px] active:shadow-[0_1px_0_0_var(--color-3d-shadow)]",
        ].join(" "),
        outline: [
          "bg-transparent text-foreground border-border",
          "hover:border-primary hover:text-primary hover:-translate-y-px",
          "active:translate-y-0 active:text-[var(--color-primary-active)]",
        ].join(" "),
        ghost: [
          "bg-transparent text-foreground border-transparent",
          "hover:bg-muted",
          "active:bg-[color-mix(in_oklch,var(--color-muted),black_5%)]",
        ].join(" "),
        link: [
          "bg-transparent text-primary border-transparent",
          "underline-offset-4 hover:underline",
        ].join(" "),
        chip: [
          "rounded-full bg-background text-foreground border-border",
          "shadow-[0_2px_0_0_var(--color-3d-shadow)]",
          "aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:border-primary",
          "hover:border-primary",
          "active:translate-y-px active:shadow-[0_1px_0_0_var(--color-3d-shadow)]",
        ].join(" "),
        danger: [
          "bg-destructive text-white border-destructive",
          "shadow-[0_5px_0_0_color-mix(in_oklch,var(--destructive),black_20%)]",
          "hover:translate-y-[-1px] hover:shadow-[0_6px_0_0_color-mix(in_oklch,var(--destructive),black_20%)]",
          "active:translate-y-[2px] active:shadow-[0_1px_0_0_color-mix(in_oklch,var(--destructive),black_20%)]",
        ].join(" "),
      },
      size: {
        xs: "h-7 gap-1 px-3 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-4 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        md: "h-11 gap-1.5 px-6 text-sm",
        lg: "h-12 gap-2 px-8 text-base",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "md",
  loading,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & { loading?: boolean }) {
  const has3dLoading =
    loading &&
    (variant === "primary" || variant === "cta" || variant === "danger")

  return (
    <ButtonPrimitive
      data-slot="button"
      disabled={loading || props.disabled}
      className={cn(
        buttonVariants({ variant, size }),
        has3dLoading && "btn-loading",
        className,
      )}
      {...props}
    />
  )
}

export { Button, buttonVariants }
