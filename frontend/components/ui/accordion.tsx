"use client"

import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion"
import * as React from "react"

import { cn } from "@/lib/utils"
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react"

/* ── Base-UI Accordion (used by SpotGroup etc.) ── */

function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn("flex w-full flex-col", className)}
      {...props}
    />
  )
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("not-last:border-b", className)}
      {...props}
    />
  )
}

function AccordionTrigger({
  className,
  children,
  ...props
}: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group/accordion-trigger relative flex flex-1 items-start justify-between rounded-lg border border-transparent py-2.5 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:after:border-ring aria-disabled:pointer-events-none aria-disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 **:data-[slot=accordion-trigger-icon]:text-muted-foreground",
          className
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon data-slot="accordion-trigger-icon" className="pointer-events-none shrink-0 group-aria-expanded/accordion-trigger:hidden" />
        <ChevronUpIcon data-slot="accordion-trigger-icon" className="pointer-events-none hidden shrink-0 group-aria-expanded/accordion-trigger:inline" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({
  className,
  children,
  ...props
}: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      className="overflow-hidden text-sm data-open:animate-accordion-down data-closed:animate-accordion-up"
      {...props}
    >
      <div
        className={cn(
          "h-(--accordion-panel-height) pt-0 pb-2.5 data-ending-style:h-0 data-starting-style:h-0 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
          className
        )}
      >
        {children}
      </div>
    </AccordionPrimitive.Panel>
  )
}

/* ── Animal Island CollapseCard (FAQ-style, CSS Grid collapse) ── */

export interface CollapseCardProps {
  question: React.ReactNode
  answer: React.ReactNode
  defaultExpanded?: boolean
  disabled?: boolean
  className?: string
}

const CollapseCard = React.forwardRef<HTMLDivElement, CollapseCardProps>(
  ({ question, answer, defaultExpanded = false, disabled = false, className }, ref) => {
    const [expanded, setExpanded] = React.useState(defaultExpanded)

    return (
      <div
        ref={ref}
        data-slot="collapse-card"
        className={cn(
          "relative overflow-hidden rounded-[18px] border-2 border-border bg-background transition-colors duration-[var(--duration-base)]",
          disabled && "cursor-not-allowed opacity-60",
          className,
        )}
      >
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-3 border-none bg-transparent px-6 py-4 text-left",
            disabled ? "cursor-not-allowed" : "cursor-pointer",
          )}
          onClick={() => !disabled && setExpanded((v) => !v)}
          disabled={disabled}
          aria-expanded={expanded}
        >
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-lg font-bold leading-none shadow-[0_2px_4px_rgba(25,200,185,0.3)] transition-all duration-[var(--duration-base)] ease-[var(--ease-animal)]",
              expanded && "rotate-180",
            )}
          >
            {expanded ? "\u2212" : "+"}
          </span>
          <span className="flex-1 text-base font-semibold leading-[1.4] text-foreground">
            {question}
          </span>
        </button>
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-300 ease-[var(--ease-animal)] will-change-[grid-template-rows]",
            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div
            className={cn(
              "overflow-hidden px-6 text-sm leading-[1.7] text-muted-foreground transition-[padding] duration-[var(--duration-base)] ease-[var(--ease-animal)]",
              expanded && "pb-6",
            )}
          >
            {answer}
          </div>
        </div>
      </div>
    )
  },
)
CollapseCard.displayName = "CollapseCard"

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent, CollapseCard }
