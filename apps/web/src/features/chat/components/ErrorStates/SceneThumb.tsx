import { useState } from "react";
import type { ChatDict } from "../../i18n";
import { SceneIcon } from "../SceneIcon";

type Props = Readonly<{ src?: string; alt: string; ep?: number; dict: ChatDict }>;
const FRAME = "chat-scene-thumb h-14 w-[5.5rem] shrink-0 overflow-hidden rounded-xl bg-muted object-cover";

function episodeLabel(dict: ChatDict, ep?: number): string | undefined {
  if (ep === undefined || !Number.isInteger(ep) || ep < 0) return undefined;
  return dict.errorStates.d9Episode.replace("{ep}", String(ep));
}

type PlaceholderProps = Pick<Props, "alt" | "ep" | "dict"> & Readonly<{ failed?: boolean }>;

function ScenePlaceholder({ alt, ep, dict, failed }: PlaceholderProps) {
  const label = episodeLabel(dict, ep), state = failed ? dict.errorStates.d9Failed : dict.errorStates.d9Unavailable;
  return <span className={`${FRAME} chat-scene-thumb--fallback [display:flex] flex-col items-center justify-center gap-1 text-fg`} role="img" aria-label={[alt, state].filter(Boolean).join(" · ")} title={state}>
    <SceneIcon name="photos" />
    {label ? <span className="max-w-full truncate px-1 text-xs font-medium leading-4">{label}</span> : null}
  </span>;
}

/** A failed or absent photo preserves its slot and only shows supplied episode metadata. */
export function SceneThumb({ src, alt, ep, dict }: Props) {
  const [failed, setFailed] = useState(false), [prevSrc, setPrevSrc] = useState(src);
  if (prevSrc !== src) { setPrevSrc(src); setFailed(false); }
  if (!src?.trim() || failed) return <ScenePlaceholder alt={alt} ep={ep} dict={dict} failed={failed} />;
  return <img key={src} className={FRAME} src={src} alt={alt} loading="lazy" decoding="async" onError={() => { setFailed(true); }} />;
}
