"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export type CheckboxSize = "small" | "middle" | "large"

export interface CheckboxOption {
  label: React.ReactNode
  value: string | number
  disabled?: boolean
}

export interface CheckboxGroupProps {
  options: CheckboxOption[]
  value?: Array<string | number>
  defaultValue?: Array<string | number>
  size?: CheckboxSize
  disabled?: boolean
  direction?: "horizontal" | "vertical"
  onChange?: (values: Array<string | number>) => void
  className?: string
}

const sizeMap = {
  small: { box: "size-[18px] rounded-[10px]", check: "size-2.5", label: "text-sm" },
  middle: { box: "size-[22px] rounded-[12px]", check: "size-3", label: "text-base" },
  large: { box: "size-7 rounded-[14px]", check: "size-4", label: "text-lg" },
} as const

const EMPTY_VALUES: Array<string | number> = []

interface CheckboxOptionProps {
  opt: CheckboxOption
  isChecked: boolean
  isDisabled: boolean
  size: typeof sizeMap[CheckboxSize]
  onToggle: () => void
}

function CheckboxOptionItem({ opt, isChecked, isDisabled, size: s, onToggle }: CheckboxOptionProps) {
  return (
    <label
      key={String(opt.value)}
      className={cn(
        "inline-flex cursor-pointer select-none items-center gap-2 transition-all duration-[var(--duration-base)] ease-[var(--ease-animal)]",
        isDisabled && "cursor-not-allowed opacity-55",
      )}
      onClick={onToggle}
    >
      <span
        role="checkbox"
        aria-checked={isChecked}
        tabIndex={isDisabled ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault()
            onToggle()
          }
        }}
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center border-2 transition-all duration-[var(--duration-base)] ease-[var(--ease-animal)]",
          s.box,
          isChecked
            ? "border-[var(--color-primary-active)] bg-secondary"
            : "border-border bg-card",
          isDisabled && "border-border bg-muted",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        )}
      >
        {isChecked && (
          <span className={cn("flex items-center justify-center text-white animate-[animal-checkbox-pop_150ms_ease-[var(--ease-animal)]]", s.check)}>
            <svg viewBox="0 0 16 16" fill="none" className="size-full">
              <path
                d="M2 8L6 12L14 4"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}
      </span>
      <span
        className={cn(
          "font-medium tracking-[0.01em] text-foreground transition-colors duration-[var(--duration-fast)]",
          s.label,
          isDisabled && "text-border",
        )}
      >
        {opt.label}
      </span>
    </label>
  )
}

const CheckboxGroup = React.forwardRef<HTMLDivElement, CheckboxGroupProps>(
  (
    {
      options,
      value,
      defaultValue,
      size = "middle",
      disabled = false,
      direction = "horizontal",
      onChange,
      className,
    },
    ref,
  ) => {
    const [innerValue, setInnerValue] = React.useState<Array<string | number>>(() => defaultValue ?? EMPTY_VALUES)
    const isControlled = value !== undefined
    const checkedValues = isControlled ? value : innerValue

    const handleChange = React.useCallback(
      (optValue: string | number, optDisabled?: boolean) => {
        if (disabled || optDisabled) return
        const next = checkedValues.includes(optValue)
          ? checkedValues.filter((v) => v !== optValue)
          : [...checkedValues, optValue]
        if (!isControlled) setInnerValue(next)
        onChange?.(next)
      },
      [disabled, checkedValues, isControlled, onChange],
    )

    const s = sizeMap[size]

    return (
      <div
        ref={ref}
        data-slot="checkbox-group"
        className={cn(
          "flex flex-wrap",
          direction === "horizontal" ? "flex-row gap-3" : "flex-col gap-2",
          disabled && "cursor-not-allowed",
          className,
        )}
      >
        {options.map((opt) => (
          <CheckboxOptionItem
            key={String(opt.value)}
            opt={opt}
            isChecked={checkedValues.includes(opt.value)}
            isDisabled={disabled || !!opt.disabled}
            size={s}
            onToggle={() => handleChange(opt.value, opt.disabled)}
          />
        ))}
      </div>
    )
  },
)
CheckboxGroup.displayName = "CheckboxGroup"

export { CheckboxGroup }
