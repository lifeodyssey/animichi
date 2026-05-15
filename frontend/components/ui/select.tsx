"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export interface SelectOption {
  key: string
  label: string
}

export interface SelectProps {
  options: SelectOption[]
  value: string
  onChange: (key: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

const Select = React.forwardRef<HTMLDivElement, SelectProps>(
  ({ options, value, onChange, placeholder = "Select...", disabled = false, className }, ref) => {
    const [open, setOpen] = React.useState(false)
    const flipUpRef = React.useRef(false)
    const wrapperRef = React.useRef<HTMLDivElement>(null)

    const optionsMap = React.useMemo(
      () => new Map(options.map(o => [o.key, o.label])),
      [options]
    )
    const currentLabel = optionsMap.get(value) ?? placeholder

    React.useEffect(() => {
      if (!open) return
      const handleClickOutside = (e: MouseEvent) => {
        if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
          setOpen(false)
        }
      }
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [open])

    React.useEffect(() => {
      if (!open || !wrapperRef.current) return
      const rect = wrapperRef.current.getBoundingClientRect()
      const dropdownHeight = options.length * 44 + 24
      const spaceBelow = window.innerHeight - rect.bottom
      flipUpRef.current = spaceBelow < dropdownHeight && rect.top > spaceBelow
    }, [open, options.length])

    const handleSelect = (key: string) => {
      onChange(key)
      setOpen(false)
    }

    return (
      <div
        ref={(node) => {
          (wrapperRef as React.MutableRefObject<HTMLDivElement | null>).current = node
          if (typeof ref === "function") ref(node)
          else if (ref) ref.current = node
        }}
        data-slot="select"
        className={cn("relative inline-block min-w-[140px] select-none", className)}
      >
        <div
          className={cn(
            "flex cursor-pointer items-center justify-between rounded-[12px] border-2 border-[var(--color-border-light)] bg-background px-[13px] py-2 transition-all duration-200 ease-out",
            open && "border-[var(--color-border-hover)]",
            !open && "hover:border-[var(--color-border-hover)] hover:bg-[var(--color-surface)]",
            disabled && "cursor-not-allowed opacity-50 bg-muted",
          )}
          onClick={() => !disabled && setOpen((v) => !v)}
        >
          <span
            className={cn(
              "text-sm",
              value ? "font-semibold text-foreground" : "font-normal italic text-muted-foreground",
            )}
          >
            {currentLabel}
          </span>
          <span
            className={cn(
              "flex items-center text-muted-foreground transition-transform duration-200 ease-out",
              open && "rotate-180 text-secondary",
            )}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M3 4.5L6 7.5L9 4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
        {open && (
          <div
            className={cn(
              "absolute z-50 rounded-[28px] bg-[#FFEEA0] py-3 animate-[fade-in_200ms_ease]",
              flipUpRef.current ? "bottom-full mb-1.5" : "top-full mt-1.5",
              "left-0 min-w-full",
            )}
          >
            {options.map((option) => (
              <div
                key={option.key}
                className={cn(
                  "relative flex cursor-pointer items-center justify-center whitespace-nowrap px-[30px] py-2.5 text-sm font-medium text-foreground transition-colors",
                  value === option.key && "font-bold",
                  "hover:font-bold",
                )}
                onClick={() => handleSelect(option.key)}
              >
                {option.label}
                {value === option.key && (
                  <div className="absolute inset-x-5 top-[56%] -z-10 h-3.5 -translate-y-1/2 rounded-[7px] bg-focus opacity-30" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  },
)
Select.displayName = "Select"

export { Select }
