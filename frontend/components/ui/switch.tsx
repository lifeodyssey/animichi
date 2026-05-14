"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export type SwitchSize = "small" | "default"

export interface SwitchProps {
  checked?: boolean
  defaultChecked?: boolean
  size?: SwitchSize
  disabled?: boolean
  checkedChildren?: React.ReactNode
  unCheckedChildren?: React.ReactNode
  onChange?: (checked: boolean) => void
  className?: string
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      checked,
      defaultChecked = false,
      size = "default",
      disabled = false,
      checkedChildren,
      unCheckedChildren,
      onChange,
      className,
    },
    ref,
  ) => {
    const [innerChecked, setInnerChecked] = React.useState(() => defaultChecked ?? false)
    const isControlled = checked !== undefined
    const isChecked = isControlled ? checked : innerChecked

    const handleClick = React.useCallback(() => {
      if (disabled) return
      const next = !isChecked
      if (!isControlled) setInnerChecked(next)
      onChange?.(next)
    }, [disabled, isChecked, isControlled, onChange])

    const isSmall = size === "small"

    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={isChecked}
        data-slot="switch"
        className={cn(
          "relative inline-flex items-center rounded-full border-[2.5px] p-0 outline-none transition-all duration-[var(--duration-base)] ease-[var(--ease-animal)]",
          isSmall ? "h-5 min-w-[38px]" : "h-7 min-w-[52px]",
          isChecked
            ? "border-success-fg bg-[var(--color-switch-on)] shadow-[var(--shadow-switch-on)]"
            : "border-border bg-[var(--color-switch-off)] shadow-[var(--shadow-switch-off)]",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          !disabled && !isChecked && "hover:border-[var(--color-border-hover)]",
          !disabled && isChecked && "hover:border-[var(--color-success-fg)] hover:bg-[var(--color-switch-on)]/90",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          className,
        )}
        onClick={handleClick}
        disabled={disabled}
      >
        <span
          className={cn(
            "absolute flex items-center justify-center rounded-full border-[2.5px] bg-card transition-all duration-[var(--duration-base)] ease-[var(--ease-animal)]",
            isSmall ? "top-px size-3.5" : "top-0.5 size-[21px]",
            isChecked
              ? "border-success-fg"
              : "border-border",
            isChecked
              ? isSmall
                ? "left-[calc(100%-16px)]"
                : "left-[calc(100%-24px)]"
              : isSmall
                ? "left-px"
                : "left-0.5",
          )}
        />
        <span
          className={cn(
            "block whitespace-nowrap text-[11px] font-bold leading-none tracking-[0.02em] text-white",
            isSmall ? "text-[9px]" : "text-[11px]",
            isChecked
              ? isSmall
                ? "px-0 pl-1.5 pr-5"
                : "px-0 pl-2 pr-7"
              : isSmall
                ? "px-0 pl-5 pr-1.5"
                : "px-0 pl-7 pr-2",
          )}
        >
          {isChecked ? checkedChildren : unCheckedChildren}
        </span>
      </button>
    )
  },
)
Switch.displayName = "Switch"

export { Switch }
