import { selectShioriLayout, type ShioriLayout, type ShioriStatus } from "./layoutSelector";
import { AlbumGrid } from "./layouts/AlbumGrid";
import { PosterFallback } from "./layouts/PosterFallback";
import { PosterSingle } from "./layouts/PosterSingle";
import { Ticket } from "./layouts/Ticket";
import type { ShioriPhoto, ShioriRouteProps } from "./types";

export type ShioriCardProps = ShioriRouteProps &
  Readonly<{ status: ShioriStatus; photos: readonly ShioriPhoto[] }>;

/** Layout dispatcher: the route state and photo count pick the layout, never the user. */
export function ShioriCard(props: ShioriCardProps) {
  const layout = selectShioriLayout(props.status, props.photos.length);
  return renderLayout(layout, props);
}

function renderLayout(layout: ShioriLayout, { meta, itinerary, photos }: ShioriCardProps) {
  if (layout === "ticket") return <Ticket meta={meta} itinerary={itinerary} />;
  if (layout === "album-grid") {
    return <AlbumGrid meta={meta} itinerary={itinerary} photos={photos} />;
  }
  if (layout === "single-panel") {
    return <PosterSingle meta={meta} itinerary={itinerary} photos={photos} />;
  }
  return <PosterFallback meta={meta} itinerary={itinerary} />;
}
