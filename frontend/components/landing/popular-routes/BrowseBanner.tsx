import FoxGuide from "@/components/generative/FoxGuide";
import TicketStub from "@/components/landing/decor/TicketStub";

interface BrowseBannerProps {
  note: string;
}

/**
 * BrowseBanner — the parchment "start browsing before login" footer banner under
 * the popular-routes grid, with the traveler fox guide and a ticket stub.
 */
export default function BrowseBanner({ note }: BrowseBannerProps) {
  return (
    <div className="paper-surface relative mt-12 flex items-center gap-5 overflow-visible rounded-[20px] px-6 py-5 sm:px-8">
      <div className="relative hidden h-16 w-24 shrink-0 sm:block">
        <FoxGuide pose="traveler" size="lg" surface="welcome" className="-top-16 left-0" />
      </div>
      <p className="flex-1 text-[13px] leading-relaxed text-muted-foreground">
        <span className="font-display text-[15px] font-bold text-fg-heading">
          Start browsing before login.
        </span>
        <br />
        {note}
      </p>
      <TicketStub label="Let's go!" rotate={5} className="hidden shrink-0 sm:flex" />
    </div>
  );
}
