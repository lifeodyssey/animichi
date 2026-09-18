import { useState } from "react";
import { ANITABI_THUMBNAIL_PLAN, withAnitabiImagePlan } from "@animichi/contract/anitabi-display";
import { ShotCredit } from "../../../lib/landmark-shot";
import type { ChatDict } from "../i18n";
import type { SceneViewpoint } from "../lib/scene-group";
import { sceneCredit, sceneGroupTitle } from "../lib/scene-group";
import { selectedPlacesCopy } from "../selected-places-copy";
import { SceneGroupPreview } from "./SceneGroupPreview";
import { SceneIcon } from "./SceneIcon";

type Props = Readonly<{ placeName: string; viewpoint: SceneViewpoint; dict: ChatDict }>;
const SHAPE = "h-14 w-full overflow-hidden rounded-xl bg-card @min-[23rem]/review:h-16";

export function SelectedPlaceThumbnail({ placeName, viewpoint, dict }: Props) {
  const source = viewpoint.frames.find((frame) => frame.url)?.url;
  const [failed, setFailed] = useState<string>(), [open, setOpen] = useState(false);
  if (!source || failed === source) return <span role="img" aria-label={selectedPlacesCopy(dict.locale).photoUnavailable} title={selectedPlacesCopy(dict.locale).photoUnavailable} className={`${SHAPE} grid place-items-center text-muted-fg`}><SceneIcon name="photos" /></span>;
  const title = sceneGroupTitle(placeName, viewpoint);
  return <><button type="button" className={`${SHAPE} cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong`} onClick={() => { setOpen(true); }} aria-haspopup="dialog" aria-label={`${dict.search.previewScene}: ${title}`}>
    <img src={withAnitabiImagePlan(source, ANITABI_THUMBNAIL_PLAN)} alt={title} decoding="async" onError={() => { setFailed(source); }} className="h-full! w-full! object-cover" />
  </button><ShotCredit credit={sceneCredit(viewpoint)} />{open ? <SceneGroupPreview key={viewpoint.id} viewpoint={viewpoint} placeName={placeName} dict={dict} onClose={() => { setOpen(false); }} /> : null}</>;
}
