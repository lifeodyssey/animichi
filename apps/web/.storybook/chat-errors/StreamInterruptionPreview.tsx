import { useState } from "react";
import type { ComponentProps } from "react";
import { StreamInterruption } from "../../src/features/chat/components/ErrorStates/StreamInterruption";
import { MESSAGE_LIST_CLASS, MessageText, MessageTurn } from "../../src/features/chat/components/MessagePresentation";
import type { ChatDict } from "../../src/features/chat/i18n";

export type StreamInterruptionPreviewProps = ComponentProps<typeof StreamInterruption> & Readonly<{ withMessage?: boolean }>;
const WIDTH = "w-[min(452px,calc(100vw_-_80px))] max-w-full";
const COPY = {
  zh: { question: "想去《你的名字。》的取景地，先看看东京有哪些地方。", partial: "我们先看东京的取景地。四谷附近的地点可以一起浏览，再…" },
  ja: { question: "『君の名は。』の舞台に行きたい。まずは東京の場所を見たい。", partial: "まずは東京の舞台を見てみよう。四ツ谷周辺の場所はまとめて見られるよ。それから…" },
  en: { question: "I'd like to visit the locations from Your Name. What can I see in Tokyo?", partial: "Let's start with the Tokyo locations. You can browse the places around Yotsuya together, then…" },
} as const;

/** Authored partial-message context only; no page shell or service result. */
function PartialMessage({ dict }: Readonly<{ dict: ChatDict }>) {
  const copy = COPY[dict.locale];
  return <ol className={MESSAGE_LIST_CLASS}>
    <MessageTurn role="user"><MessageText text={copy.question} /></MessageTurn>
    <MessageTurn role="assistant"><MessageText text={copy.partial} /></MessageTurn>
  </ol>;
}

/** A click demonstrates the read-latest pending branch, never a completed recovery. */
export function StreamInterruptionPreview(props: StreamInterruptionPreviewProps) {
  const [requested, setRequested] = useState(false);
  const retry = () => { if (requested || props.recovering) return; props.onRetry(); setRequested(true); };
  return <div className={`${WIDTH} grid gap-6`}>
    {props.withMessage ? <PartialMessage dict={props.dict} /> : null}
    <StreamInterruption {...props} onRetry={retry} recovering={requested || props.recovering === true} />
  </div>;
}
