import { useState } from "react";
import type { ChatDict } from "../i18n";
import type { SceneViewpoint } from "../lib/scene-group";
import { sceneGroupTitle } from "../lib/scene-group";
import { selectedPlacesCopy } from "../selected-places-copy";
import { SceneGroupPreview } from "./SceneGroupPreview";
import { SceneIcon } from "./SceneIcon";

type Props = Readonly<{ placeName: string; viewpoint: SceneViewpoint; dict: ChatDict }>;
const SHAPE = "h-14 w-full overflow-hidden rounded-xl bg-card @min-[23rem]/review:h-16";

export function SelectedPlaceThumbnail({ placeName, viewpoint, dict }: Props) {
  const source = viewpoint.frames.find((frame) => frame.url)?.url;
  const [failed, setFailed] = useState<string>(), [open, setOpen] = useState(false);
  if (!source || failed === source) return <span role="img" aria-label={selectedPlacesCopy(dict.locale).photoUnavailable} title={selectedPlacesCopy(dict.locale).photoUnavailable} className={`${SHAPE} grid place-items-center text-muted-fg`}><SceneIcon name="photos" /></span>;
  return <><button type="button" className={`${SHAPE} cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong`} onClick={() => { setOpen(true); }} aria-haspopup="dialog" aria-label={`${dict.search.previewScene}: ${sceneGroupTitle(placeName, viewpoint)}`}>
    <img src={source} alt={sceneGroupTitle(placeName, viewpoint)} loading="lazy" decoding="async" onError={() => { setFailed(source); }} className="h-full! w-full! object-cover" />
  </button>{open ? <SceneGroupPreview key={viewpoint.id} viewpoint={viewpoint} placeName={placeName} dict={dict} onClose={() => { setOpen(false); }} /> : null}</>;
}
