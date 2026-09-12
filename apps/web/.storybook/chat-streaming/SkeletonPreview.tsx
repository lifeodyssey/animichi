import { Button } from "animal-island-ui-tailwind/button";
import { useState, type ComponentProps } from "react";
import { DataPartCard } from "../../src/features/chat/components/DataPartCard";
import { MESSAGE_LIST_CLASS, MessageText, MessageTurn } from "../../src/features/chat/components/MessagePresentation";
import { chatDictFor, type ChatDict } from "../../src/features/chat/i18n";
import type { Locale } from "../../src/i18n/locales";
import { isLocale } from "../../src/i18n/locales";
import { clarifyPart } from "../chat-cards/fixtures";

type Props = ComponentProps<typeof DataPartCard>;
type Phase = "receiving" | "ready" | "incomplete";
const WIDTH = "w-[min(452px,calc(100vw_-_80px))] max-w-full";
const COPY = {
  zh: { question: "想去《吹响吧！上低音号》的取景地看看。", note: "状态切换预览 · 使用固定样例，不发送请求", receiving: "接收中", ready: "收到内容", incomplete: "未完整接收" },
  ja: { question: "『響け！ユーフォニアム』の舞台を見てみたい。", note: "状態のプレビュー · 固定サンプル、リクエストなし", receiving: "受信中", ready: "内容を受信", incomplete: "受信未完了" },
  en: { question: "I'd like to see the locations from Sound! Euphonium.", note: "State preview · Fixed examples, no requests", receiving: "Receiving", ready: "Content received", incomplete: "Incomplete" },
} as const;

export function skeletonPreviewCopy(locale: Locale) {
  return COPY[locale];
}

export function skeletonPreviewDict(locale: unknown): ChatDict {
  return chatDictFor(typeof locale === "string" && isLocale(locale) ? locale : "zh");
}

export function SkeletonPreview(props: Props) {
  return <div className={WIDTH}><DataPartCard {...props} /></div>;
}

export function SkeletonWithMessage(props: Props) {
  return <div className={WIDTH}><ol className={MESSAGE_LIST_CLASS}>
    <MessageTurn role="user"><MessageText text={COPY[props.dict.locale].question} /></MessageTurn>
    <MessageTurn role="assistant"><DataPartCard {...props} /></MessageTurn>
  </ol></div>;
}

type ControlsProps = Readonly<{ phase: Phase; onChange: (phase: Phase) => void; dict: ChatDict }>;
const PHASES = ["receiving", "ready", "incomplete"] as const;
const BUTTON_CLASS = "[min-height:44px]! [height:auto]! [padding:8px_12px]! [font-size:12px]! [line-height:1.5]! [white-space:normal]! [--animal-bg-color:var(--color-paper)] [--animal-text-color:var(--color-primary-strong)] aria-pressed:[--animal-bg-color:var(--color-primary-soft)] motion-reduce:[transition:none]!";

function PreviewControls({ phase, onChange, dict }: ControlsProps) {
  const copy = COPY[dict.locale];
  return <div className="grid gap-2 border-t border-border-soft pt-5" data-preview-controls>
    <p className="text-xs leading-5 text-muted-fg">{copy.note}</p>
    <div className="[display:flex] flex-wrap gap-2">{PHASES.map(value => <Button key={value} type="default" htmlType="button" className={BUTTON_CLASS} aria-pressed={phase === value} onClick={() => { onChange(value); }}>{copy[value]}</Button>)}</div>
  </div>;
}

/** Replaces the same DataPartCard's data locally; the sample is not a streamed server response. */
export function SkeletonTransitionPreview({ dict }: Readonly<{ dict: ChatDict }>) {
  const [phase, setPhase] = useState<Phase>("receiving");
  const data = phase === "ready" ? clarifyPart : { intent: "clarify" };
  return <div className={`${WIDTH} grid gap-8`}>
    <SkeletonWithMessage data={data} dict={dict} pending={phase === "receiving"} />
    <PreviewControls phase={phase} onChange={setPhase} dict={dict} />
  </div>;
}
