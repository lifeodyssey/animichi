"use client";

import type { PilgrimagePoint } from "../../lib/types";
import { useLocale } from "../../lib/i18n-context";
import { handleImageError } from "../auth/LandingData";

interface FilmstripProps {
  points: PilgrimagePoint[];
  /** Optional section label shown above the strip */
  label?: string;
}

export default function Filmstrip({ points, label }: FilmstripProps) {
  const locale = useLocale();
  const withScreenshots = points.filter((p) => p.screenshot_url);

  if (withScreenshots.length === 0) return null;

  return (
    <div className="pb-2 pt-5">
      {label && (
        <p className="mb-3 px-5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:px-8">
          {label}
        </p>
      )}
      <div
        className="flex gap-4 overflow-x-auto px-5 pb-5 sm:px-8"
        style={{
          WebkitMaskImage: "linear-gradient(to right, transparent, black 20px, black calc(100% - 20px), transparent)",
          maskImage: "linear-gradient(to right, transparent, black 20px, black calc(100% - 20px), transparent)",
          scrollbarWidth: "none",
        }}
      >
        {withScreenshots.map((point) => {
          const name = locale === "zh" && point.name_cn ? point.name_cn : point.name;
          return (
            <div
              key={point.id}
              className="relative w-[280px] flex-shrink-0 overflow-hidden rounded-xl"
            >
              <div className="aspect-[16/9]">
                <img
                  src={point.screenshot_url!}
                  alt={name}
                  width={280}
                  height={158}
                  loading="lazy"
                  className="h-full w-full object-cover"
                  onError={handleImageError}
                />
              </div>
              <div
                className="absolute inset-x-0 bottom-0 truncate px-3 py-2.5 text-xs font-medium text-white"
                style={{ background: "linear-gradient(transparent, var(--color-overlay-image))" }}
              >
                {name}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
