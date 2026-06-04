import Link from "next/link";
import { cn } from "@/lib/utils";
import RouteLine from "@/components/landing/decor/RouteLine";
import LocationBadge from "@/components/landing/decor/LocationBadge";
import RouteTag from "@/components/landing/popular-routes/RouteTag";
import { type AnimeGalleryItem, handleImageError } from "@/components/auth/LandingData";
import { storeRecentRoute } from "@/hooks/useRecentRoute";

const ROUTE_TAGS: Record<string, string[]> = {
  "115908": ["school", "river"],
  "160209": ["city", "nature"],
  "269235": ["city", "sky"],
  "328609": ["street", "live house"],
  "1424": ["school", "countryside"],
  "362577": ["journey", "ruins"],
  "100444": ["city", "school"],
  "27364": ["old town", "nature"],
};

function splitCount(count: string): { spots: string; place: string } {
  const [spots, place] = count.split("·");
  return { spots: spots?.trim() ?? count, place: place?.trim() ?? "" };
}

interface RouteCardProps {
  item: AnimeGalleryItem;
  index: number;
  addRevealRef: (el: HTMLElement | null) => void;
}

/**
 * RouteCard — a single popular-route tile: cover photo with a place badge and
 * compare-seam handle, then title, spot count, attribute tags, and a route line.
 */
export default function RouteCard({ item, index, addRevealRef }: RouteCardProps) {
  const tags = ROUTE_TAGS[item.bangumiId] ?? [];
  const { spots, place } = splitCount(item.count);

  return (
    <Link
      href={`/anime/${item.bangumiId}`}
      onClick={() => storeRecentRoute({ bangumiId: item.bangumiId, title: item.title })}
      ref={addRevealRef}
      className={cn(
        "seichi-reveal-pop group flex flex-col overflow-hidden rounded-[18px] border border-border bg-card",
        "transition-[transform,box-shadow] duration-300 ease-[var(--ease-out-expo)]",
        "hover:-translate-y-1.5 hover:shadow-card",
      )}
      style={{ animationDelay: `${index * 0.06}s` }}
      aria-label={item.title}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <img
          src={`/images/bangumi/${item.bangumiId}.jpg`}
          alt={item.title}
          loading={index < 2 ? "eager" : "lazy"}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          onError={handleImageError}
        />
        {place ? (
          <LocationBadge name={place} className="absolute right-2 top-2" />
        ) : null}
        {/* Compare seam handle */}
        <div className="absolute left-1/2 top-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-background bg-card/90 shadow-sm">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M4 2L1 7L4 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55" />
            <path d="M10 2L13 7L10 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55" />
          </svg>
        </div>
        <span
          className="pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-background/70"
          aria-hidden="true"
        />
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <h3 className="font-display text-[15px] font-bold leading-snug text-fg-heading">
          {item.title}
        </h3>
        <p className="text-[12px] font-medium text-muted-foreground">
          <span className="text-fg">{spots}</span>
          {place ? ` · ${place}` : ""}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <RouteTag key={tag} label={tag} />
          ))}
        </div>
        <div className="mt-auto pt-1">
          <RouteLine />
        </div>
      </div>
    </Link>
  );
}
