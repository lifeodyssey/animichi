"use client";

import { useMemo, useState } from "react";
import type { SearchResultData, PilgrimagePoint } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import { formatDistance } from "../../lib/geo";
import { groupByAnime, CHIP_COLORS } from "./NearbyChips";
import { colorValue } from "../../lib/color";
import { Button } from "@/components/ui/button";

interface NearbyBubbleProps {
  data: SearchResultData;
  onSuggest?: (text: string) => void;
}

interface AnimeCardProps {
  title: string;
  colorIndex: number;
  imageUrl: string | null;
  spotsDistanceLabel: string;
  onClick: () => void;
}

function AnimeNearbyCard({
  title,
  colorIndex,
  imageUrl,
  spotsDistanceLabel,
  onClick,
}: AnimeCardProps) {
  const [imgError, setImgError] = useState(false);
  const color = CHIP_COLORS[colorIndex % CHIP_COLORS.length];
  const dotColor = colorValue(color.hue, color.chroma, 55);

  return (
    <Button
      variant="outline"
      size="md"
      onClick={onClick}
      className="w-full justify-start gap-4 px-5 py-4 font-normal hover:-translate-y-0.5 hover:shadow-sm active:translate-y-0 transition-all duration-150 ease-[var(--ease-animal)]"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: dotColor }}
        aria-hidden="true"
      />
      {imageUrl && !imgError ? (
        <img
          src={imageUrl}
          alt=""
          className="h-10 w-12 shrink-0 rounded-sm object-cover bg-muted"
          onError={() => setImgError(true)}
        />
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
        <span
          className="truncate text-sm text-foreground font-display"
        >
          {title}
        </span>
        <span className="text-xs text-muted-foreground">
          {spotsDistanceLabel}
        </span>
      </span>
      <span className="shrink-0 text-base text-primary" aria-hidden="true">
        →
      </span>
    </Button>
  );
}

export default function NearbyBubble({ data, onSuggest }: NearbyBubbleProps) {
  const { nearby: nt } = useDict();
  const points = data.results.rows;
  const backendGroups = data.results.nearby_groups;

  const groupsWithDistance = useMemo(() => {
    // Prefer backend-provided nearby_groups when available
    if (backendGroups && backendGroups.length > 0) {
      return backendGroups.map((bg, index) => {
        const firstPoint = points.find((p) => p.bangumi_id === bg.bangumi_id);
        return {
          bangumi_id: bg.bangumi_id,
          title: bg.title,
          points_count: bg.points_count,
          color_index: index % CHIP_COLORS.length,
          closestDistance: bg.closest_distance_m,
          imageUrl: bg.cover_url ?? firstPoint?.screenshot_url ?? null,
        };
      });
    }

    // Fallback: compute groups from raw points (backward compat for old sessions)
    const groups = groupByAnime(points);
    const pointsByBangumi = new Map<string, PilgrimagePoint[]>();
    for (const point of points) {
      const key = point.bangumi_id ?? "";
      const arr = pointsByBangumi.get(key) ?? [];
      arr.push(point);
      pointsByBangumi.set(key, arr);
    }

    return groups.map((group) => {
      const groupPoints = pointsByBangumi.get(group.bangumi_id) ?? [];
      const closestDistance = groupPoints.reduce((min, p) => {
        const d = p.distance_m ?? Infinity;
        return d < min ? d : min;
      }, Infinity);
      const firstPoint = groupPoints[0];
      const imageUrl = firstPoint?.screenshot_url ?? null;
      return {
        ...group,
        closestDistance: closestDistance === Infinity ? 0 : closestDistance,
        imageUrl,
      };
    });
  }, [points, backendGroups]);

  const total = points.length;
  const radiusM = data.results.metadata?.radius_m;
  const radius = radiusM ? formatDistance(radiusM) : "1km";

  return (
    <div>
      <p className="text-sm font-light leading-loose text-foreground">
        {nt.summary
          .replace("{radius}", radius)
          .replace("{count}", String(groupsWithDistance.length))
          .replace("{total}", String(total))}
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {groupsWithDistance.map((group) => (
          <AnimeNearbyCard
            key={group.bangumi_id}
            title={group.title}
            colorIndex={group.color_index}
            imageUrl={group.imageUrl}
            spotsDistanceLabel={nt.spots_distance
              .replace("{spotCount}", String(group.points_count))
              .replace("{dist}", formatDistance(group.closestDistance))}
            onClick={() => onSuggest?.(nt.search_anime_nearby.replace("{title}", group.title))}
          />
        ))}
      </div>

      <Button
        variant="default"
        size="md"
        onClick={() => onSuggest?.(nt.show_all_nearby)}
        className="mt-3 w-full justify-start gap-4 px-5 py-4 font-normal"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </span>
        <span className="flex-1 text-left text-sm text-foreground">{nt.view_all.replace("{total}", String(total))}</span>
        <span className="text-sm text-muted-foreground">→</span>
      </Button>
    </div>
  );
}
