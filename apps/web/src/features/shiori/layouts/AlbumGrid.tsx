import type { ShioriPhoto, ShioriRouteProps } from "../types";
import { albumOverflowCount, visibleAlbumCount } from "../layoutSelector";
import { shioriTimeWindow } from "../timeWindow";
import { PhotoTile } from "./PhotoTile";
import { ShioriFrame, ShioriHeader } from "./ShioriChrome";

type AlbumGridProps = ShioriRouteProps & Readonly<{ photos: readonly ShioriPhoto[] }>;

/** アルバム格子: capacity-capped 対比図 grid with a +N overflow badge. */
export function AlbumGrid({ meta, itinerary, photos }: AlbumGridProps) {
  return (
    <ShioriFrame layout="album-grid" label="完走記念しおり">
      <ShioriHeader eyebrow="SEICHIJUNREI · 完走記念" meta={meta} />
      <GridTiles photos={photos} />
      <p className="shiori-window">{gridSummary(shioriTimeWindow(itinerary), photos.length)}</p>
    </ShioriFrame>
  );
}

function gridSummary(window: string | null, photoCount: number): string {
  const photoLabel = `対比図${String(photoCount)}枚`;
  return window ? `${window} · ${photoLabel}` : photoLabel;
}

function GridTiles({ photos }: Readonly<{ photos: readonly ShioriPhoto[] }>) {
  const visible = photos.slice(0, visibleAlbumCount(photos.length));
  return (
    <ul className="shiori-grid">
      {visible.map((photo, index) => (
        <GridTile key={photo.id} photo={photo} isLast={index === visible.length - 1} total={photos.length} />
      ))}
    </ul>
  );
}

type GridTileProps = Readonly<{ photo: ShioriPhoto; isLast: boolean; total: number }>;

function GridTile({ photo, isLast, total }: GridTileProps) {
  const overflow = isLast ? albumOverflowCount(total) : 0;
  return (
    <li className="shiori-grid__cell">
      <PhotoTile photo={photo} />
      {overflow > 0 ? <span className="shiori-grid__overflow">{`+${String(overflow)}`}</span> : null}
    </li>
  );
}
