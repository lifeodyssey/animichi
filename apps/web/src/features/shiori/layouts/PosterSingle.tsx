import type { ShioriPhoto, ShioriRouteProps } from "../types";
import { PhotoTile } from "./PhotoTile";
import { ShioriFrame, ShioriHeader, ShioriTimeWindow } from "./ShioriChrome";

type PosterSingleProps = ShioriRouteProps & Readonly<{ photos: readonly ShioriPhoto[] }>;

/** 一枚看板: one hero 対比図 with an optional secondary thumbnail. */
export function PosterSingle({ meta, itinerary, photos }: PosterSingleProps) {
  return (
    <ShioriFrame layout="single-panel" label="完走記念しおり">
      <ShioriHeader eyebrow="SEICHIJUNREI · 完走記念" meta={meta} />
      <SingleHero photo={photos[0]} total={photos.length} />
      <SecondPhotoStrip photo={photos[1]} />
      <ShioriTimeWindow itinerary={itinerary} />
    </ShioriFrame>
  );
}

function SingleHero({ photo, total }: Readonly<{ photo?: ShioriPhoto; total: number }>) {
  if (!photo) return null;
  return (
    <div className="shiori-hero">
      <PhotoTile photo={photo} />
      <HeroCaption spotName={photo.spotName} total={total} />
    </div>
  );
}

function HeroCaption({ spotName, total }: Readonly<{ spotName: string; total: number }>) {
  return (
    <p className="shiori-hero__caption">
      <span>{`${spotName} ここに立った!`}</span>
      <span className="shiori-hero__counter">{`1/${String(total)}`}</span>
    </p>
  );
}

function SecondPhotoStrip({ photo }: Readonly<{ photo?: ShioriPhoto }>) {
  if (!photo) return null;
  return (
    <div className="shiori-second">
      <PhotoTile photo={photo} />
      <p className="shiori-second__note">{`${photo.spotName} のもう1枚も収録`}</p>
    </div>
  );
}
