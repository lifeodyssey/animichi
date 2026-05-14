import * as React from "react"

import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const cardVariants = cva(
  "group/card flex flex-col gap-4 font-medium transition-all duration-300",
  {
    variants: {
      variant: {
        default:
          "cursor-pointer rounded-[20px] px-6 py-4 hover:-translate-y-0.5",
        title:
          "px-8 py-3 font-semibold [border-radius:40px_35px_45px_38px_/_38px_45px_35px_40px]",
        dashed:
          "rounded-[20px] border-2 border-dashed px-6 py-4 shadow-none hover:border-border-hover",
      },
      color: {
        default: "bg-card text-foreground",
        "app-yellow": "bg-nook-yellow text-foreground",
        "app-teal": "bg-nook-teal text-white",
        "app-red": "bg-nook-red text-white",
      },
    },
    compoundVariants: [
      { variant: "title", color: "default", className: "bg-[var(--color-surface)]" },
      {
        variant: "dashed",
        color: "default",
        className: "bg-[var(--color-surface)] border-border-light",
      },
    ],
    defaultVariants: {
      variant: "default",
      color: "default",
    },
  }
)

type CardProps = React.ComponentProps<"div"> &
  VariantProps<typeof cardVariants> & {
    size?: "default" | "sm"
  }

function Card({
  className,
  variant = "default",
  color = "default",
  size = "default",
  ...props
}: CardProps) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        cardVariants({ variant, color }),
        size === "sm" && "gap-3 py-3",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto]",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-base leading-snug font-semibold group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm opacity-70", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("text-sm", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center border-t border-current/10 pt-4",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  cardVariants,
}
