"use client";

import type { PilgrimagePoint } from "../../lib/types";
import { useLocale } from "../../lib/i18n-context";
import { handleImageError } from "../auth/LandingData";

interface FilmstripProps {
  points: PilgrimagePoint[];
}

export default function Filmstrip({ points }: FilmstripProps) {
  const locale = useLocale();
  const withScreenshots = points.filter((p) => p.screenshot_url);

  if (withScreenshots.length === 0) return null;

  return (
    <div
      className="flex gap-4 overflow-x-auto px-5 py-5 sm:px-8"
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
            className="relative flex-shrink-0 overflow-hidden rounded-xl"
            style={{ width: 280 }}
          >
            <div className="aspect-[16/9]">
              <img
                src={point.screenshot_url!}
                alt={name}
                loading="lazy"
                className="h-full w-full object-cover"
                onError={handleImageError}
              />
            </div>
            <div
              className="absolute inset-x-0 bottom-0 px-3 py-2.5 text-[12px] font-medium text-white"
              style={{ background: "linear-gradient(transparent, oklch(15% 0.02 238 / 0.75))" }}
            >
              {name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
