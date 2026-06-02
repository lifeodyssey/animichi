import { cn } from "@/lib/utils";

interface TicketStubProps {
  /** Main line, e.g. 聖地巡礼きっぷ. */
  label: string;
  /** Small secondary line, e.g. a date or code. */
  sub?: string;
  rotate?: number;
  className?: string;
}

/**
 * A perforated pilgrimage ticket / luggage tag. Notched ends and a punched hole
 * read as something kept from a real trip, reinforcing the journal narrative.
 */
export default function TicketStub({
  label,
  sub,
  rotate = -3,
  className,
}: TicketStubProps) {
  return (
    <div
      className={cn(
        "relative inline-flex items-center gap-2 rounded-[8px] border border-dashed",
        "border-explore/50 bg-card px-3 py-1.5 shadow-sm",
        className,
      )}
      style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}
    >
      <span
        className="block h-6 w-1.5 rounded-full bg-explore/25"
        aria-hidden="true"
      />
      <span className="leading-tight">
        <span className="block text-[12px] font-bold text-fg">{label}</span>
        {sub ? (
          <span className="block font-mono text-[10px] tracking-wider text-muted-foreground">
            {sub}
          </span>
        ) : null}
      </span>
    </div>
  );
}
