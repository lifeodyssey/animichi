import type { ShioriPhoto } from "../types";

type PhotoTileProps = Readonly<{ photo: ShioriPhoto }>;

/** One 対比図 tile: the composite image plus its scene attribution. */
export function PhotoTile({ photo }: PhotoTileProps) {
  return (
    <figure className="shiori-tile">
      <img src={photo.imageUrl} alt={`${photo.spotName} の対比図`} loading="lazy" />
      <TileCaption photo={photo} />
    </figure>
  );
}

function TileCaption({ photo }: PhotoTileProps) {
  return (
    <figcaption className="shiori-tile__caption">
      <span className="shiori-tile__scene">{photo.sceneLabel}</span>
      <span className="shiori-tile__time">{photo.capturedAt}</span>
    </figcaption>
  );
}
