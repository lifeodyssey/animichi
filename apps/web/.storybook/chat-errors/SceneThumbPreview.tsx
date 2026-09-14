import { Button } from "animal-island-ui-tailwind/button";
import { useState, type ComponentProps } from "react";
import { SceneThumb } from "../../src/features/chat/components/ErrorStates/SceneThumb";
import type { ChatDict } from "../../src/features/chat/i18n";

type Props = ComponentProps<typeof SceneThumb>;
export const SCENE_SOURCE = "/images/landing/route-uji.webp";
export const BROKEN_SCENE_SOURCE = "/images/storybook/missing-scene.webp";
const CORRECT_SOURCE = { zh: "换成可用图片", ja: "読み込める画像に変更", en: "Use an available image" } as const;

export function SceneThumbPreview(props: Props) {
  return <div className="[display:flex] w-[min(360px,calc(100vw_-_80px))] max-w-full items-center gap-3">
    <SceneThumb {...props} />
    <p className="min-w-0 text-sm font-semibold leading-6 text-fg [overflow-wrap:anywhere]">{props.alt}</p>
  </div>;
}

export function SceneSourceChanged({ dict }: Readonly<{ dict: ChatDict }>) {
  const [source, setSource] = useState(BROKEN_SCENE_SOURCE);
  return <div className="grid justify-items-start gap-6"><SceneThumbPreview dict={dict} alt="宇治橋" ep={8} src={source} />
    <div className="grid gap-2 border-t border-border-soft pt-4" data-preview-controls><p className="text-xs text-muted-fg">Storybook</p><Button type="default" htmlType="button" className="[min-height:44px]! [height:auto]! [white-space:normal]!" onClick={() => { setSource(SCENE_SOURCE); }}>{CORRECT_SOURCE[dict.locale]}</Button></div>
  </div>;
}
