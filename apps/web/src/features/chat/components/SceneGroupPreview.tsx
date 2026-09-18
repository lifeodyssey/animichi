import { ANITABI_MOBILE_PLAN, withAnitabiImagePlan } from "@animichi/contract/anitabi-display";
import { Button } from "animal-island-ui-tailwind/button";
import { useState } from "react";
import { ShotCredit } from "../../../lib/landmark-shot";
import type { ChatDict } from "../i18n";
import type { SceneViewpoint } from "../lib/scene-group";
import { sceneCredit, sceneGroupTitle } from "../lib/scene-group";
import { sceneGroupCopy } from "../scene-group-copy";
import { ScenePreview } from "./ScenePreview";
import { SceneIcon } from "./SceneIcon";

type Props = Readonly<{ viewpoint: SceneViewpoint; placeName: string; dict: ChatDict; onClose: () => void }>;
type NavigationProps = Readonly<{ index: number; count: number; onChange: (index: number) => void; dict: ChatDict }>;

function FrameNavigation({ index, count, onChange, dict }: NavigationProps) {
  const copy = sceneGroupCopy(dict.locale);
  if (count < 2) return null;
  return <div className="flex items-center justify-center gap-6 border-t border-border-soft px-5 py-4">
    <Button type="text" aria-label={copy.previous} disabled={index === 0} onClick={() => { onChange(index - 1); }} icon={<SceneIcon name="back" />} className="[min-height:44px]" />
    <span role="status" className="min-w-16 text-center text-sm tabular-nums text-muted-fg">{index + 1} / {count}</span>
    <Button type="text" aria-label={copy.next} disabled={index === count - 1} onClick={() => { onChange(index + 1); }} icon={<SceneIcon name="next" />} className="[min-height:44px]" />
  </div>;
}

function PreviewFooter({ viewpoint, ...nav }: NavigationProps & Readonly<{ viewpoint: SceneViewpoint }>) {
  return <><ShotCredit credit={sceneCredit(viewpoint)} /><FrameNavigation {...nav} /></>;
}

export function SceneGroupPreview({ viewpoint, placeName, dict, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const frames = viewpoint.frames.filter((frame) => frame.url);
  const frame = frames[index];
  if (!frame?.url) return null;
  return <ScenePreview src={withAnitabiImagePlan(frame.url, ANITABI_MOBILE_PLAN)} name={sceneGroupTitle(placeName, viewpoint)} caption={frame.caption} closeLabel={dict.search.closePreview} failureMessage={dict.search.sceneUnavailable} onClose={onClose} footer={<PreviewFooter viewpoint={viewpoint} index={index} count={frames.length} onChange={setIndex} dict={dict} />} />;
}
