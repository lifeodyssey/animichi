import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const inputWrapperVariants = cva(
  [
    "inline-flex items-center w-full",
    "bg-card rounded-[var(--r-pill)]",
    "border-[2.5px] border-border",
    "transition-all duration-[var(--duration-base)] ease-[var(--ease-animal)]",
    "hover:-translate-y-px hover:border-[var(--color-border-hover)] hover:shadow-[0_3px_0_0_var(--color-border)]",
    "focus-within:border-focus focus-within:shadow-[0_3px_0_0_var(--color-input-shadow),var(--shadow-focus-glow)]",
    "has-[:disabled]:bg-muted has-[:disabled]:border-input-shadow has-[:disabled]:shadow-none has-[:disabled]:opacity-60 has-[:disabled]:cursor-not-allowed",
  ].join(" "),
  {
    variants: {
      size: {
        sm: "h-8 px-5 text-xs shadow-[0_2px_0_0_var(--color-input-shadow)]",
        md: "h-10 px-6 text-sm shadow-[0_3px_0_0_var(--color-input-shadow)]",
        lg: "h-12 px-6 text-base border-[3px] shadow-[0_4px_0_0_var(--color-input-shadow)]",
      },
      status: {
        error: "border-destructive shadow-[0_3px_0_0_color-mix(in_oklch,var(--destructive),black_20%)] hover:border-error-fg hover:shadow-[0_3px_0_0_color-mix(in_oklch,var(--destructive),black_20%)]",
        warning: "border-[var(--color-warning-fg)] shadow-[0_3px_0_0_color-mix(in_oklch,var(--color-warning-fg),black_15%)] hover:border-[color-mix(in_oklch,var(--color-warning-fg),black_10%)]",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
)

type InputProps = Omit<React.ComponentProps<"input">, "size" | "prefix"> &
  VariantProps<typeof inputWrapperVariants> & {
    /** Left icon or adornment slot */
    prefix?: React.ReactNode
    /** Right icon or adornment slot */
    suffix?: React.ReactNode
  }

function Input({
  className,
  type,
  size = "md",
  status,
  prefix,
  suffix,
  disabled,
  ...props
}: InputProps) {
  return (
    <div
      data-slot="input-wrapper"
      className={cn(inputWrapperVariants({ size, status }), className)}
    >
      {prefix && (
        <span
          data-slot="input-prefix"
          className="inline-flex shrink-0 items-center text-muted-foreground mr-1.5"
        >
          {prefix}
        </span>
      )}
      <InputPrimitive
        type={type}
        disabled={disabled}
        data-slot="input"
        className={cn(
          "flex-1 w-full min-w-0",
          "border-none outline-none bg-transparent",
          "text-foreground font-medium tracking-[0.01em]",
          "placeholder:text-muted-foreground placeholder:font-normal",
          "disabled:cursor-not-allowed disabled:text-[var(--color-border)]",
          "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        )}
        {...props}
      />
      {suffix && (
        <span
          data-slot="input-suffix"
          className="inline-flex shrink-0 items-center text-muted-foreground ml-1.5"
        >
          {suffix}
        </span>
      )}
    </div>
  )
}

export { Input, inputWrapperVariants }
