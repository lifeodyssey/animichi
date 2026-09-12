import { useState } from "react";
import type { ComponentProps } from "react";
import { SessionExpired } from "../../src/features/chat/components/ErrorStates/SessionExpired";
import { MESSAGE_LIST_CLASS, MessageText, MessageTurn } from "../../src/features/chat/components/MessagePresentation";
import type { ChatDict } from "../../src/features/chat/i18n";

export type SessionExpiredPreviewProps = ComponentProps<typeof SessionExpired> & Readonly<{ withMessage?: boolean }>;
const WIDTH = "w-[min(452px,calc(100vw_-_80px))] max-w-full";
const COPY = {
  zh: { answer: "四谷的几个取景地可以放在一起看。我们也可以继续看看东京的其他地点。", question: "那再看看新宿附近的吧。" },
  ja: { answer: "四ツ谷の舞台はまとめて見られるよ。東京のほかの場所も見てみよう。", question: "じゃあ、新宿の近くも見たい。" },
  en: { answer: "You can browse the locations around Yotsuya together. We can also look at other places in Tokyo.", question: "Let's look around Shinjuku next." },
} as const;

/** Authored conversation context; no page shell or fetched history. */
function ExistingMessages({ dict }: Readonly<{ dict: ChatDict }>) {
  const copy = COPY[dict.locale];
  return <ol className={MESSAGE_LIST_CLASS}>
    <MessageTurn role="assistant"><MessageText text={copy.answer} /></MessageTurn>
    <MessageTurn role="user"><MessageText text={copy.question} /></MessageTurn>
  </ol>;
}

/** The explicit resume action demonstrates pending history, never a signed-in session. */
export function SessionExpiredPreview(props: SessionExpiredPreviewProps) {
  const [requested, setRequested] = useState(false);
  const resume = () => { if (requested || props.recovering) return; props.onResume(); setRequested(true); };
  return <div className={`${WIDTH} grid gap-6`}>
    {props.withMessage ? <ExistingMessages dict={props.dict} /> : null}
    <SessionExpired {...props} onResume={resume} recovering={requested || props.recovering === true} />
  </div>;
}
