import type { AnimeGuideResponse } from "./api/guide";
import type { PilgrimagePoint } from "./types/domain";

const SITE_URL = "https://seichijunrei.zhenjia.org";
const MAX_PLACES = 10;

export function buildBreadcrumbJsonLd(title: string, bangumiId: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Anime Guide", item: `${SITE_URL}/anime` },
      { "@type": "ListItem", position: 3, name: title, item: `${SITE_URL}/anime/${bangumiId}` },
    ],
  };
}

function spotToPlace(spot: PilgrimagePoint) {
  return {
    "@type": "TouristAttraction",
    name: spot.name,
    geo: { "@type": "GeoCoordinates", latitude: spot.latitude, longitude: spot.longitude },
    ...(spot.screenshot_url ? { image: spot.screenshot_url } : {}),
  };
}

export function buildAnimeGuideJsonLd(data: AnimeGuideResponse) {
  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: data.title,
    ...(data.title_cn ? { alternateName: data.title_cn } : {}),
    ...(data.cover_url ? { image: data.cover_url } : {}),
    url: `${SITE_URL}/anime/${data.bangumi_id}`,
    description: `${data.spot_count} pilgrimage spots`,
    ...(data.city ? { locationCreated: data.city } : {}),
    containsPlace: data.spots.slice(0, MAX_PLACES).map(spotToPlace),
  };
}
