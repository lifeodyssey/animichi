import { useState } from "react";
import { SceneGroupCard, type SceneGroupCardProps } from "../../src/features/chat/components/SceneGroupCard";

export function SceneGroupCardPreview(props: SceneGroupCardProps) {
  const [selected, setSelected] = useState(props.selected);
  const onToggle = () => { setSelected((previous) => !previous); props.onToggle(); };
  return <div className="mx-auto w-full max-w-[440px]"><SceneGroupCard {...props} selected={selected} onToggle={onToggle} /></div>;
}
