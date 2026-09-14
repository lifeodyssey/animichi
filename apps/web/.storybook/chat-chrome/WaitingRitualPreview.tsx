import type { ChatStatus, UIMessage } from "ai";
import type { ChatDict } from "../../src/features/chat/i18n";
import { MESSAGE_LIST_CLASS, MessageText, MessageTurn } from "../../src/features/chat/components/MessagePresentation";
import { WaitingFeedback, WaitingRitual, type WaitingFeedbackProps } from "../../src/features/chat/components/WaitingRitual";

const WIDTH = "w-[min(452px,calc(100vw_-_80px))] max-w-full";
const QUESTION = {
  zh: "想去《你的名字。》的取景地，先看看东京有哪些地方。",
  en: "I'd like to visit the locations from Your Name. What can I see in Tokyo?",
  ja: "『君の名は。』の舞台に行きたい。まずは東京の場所を見たい。",
} as const;

export function WaitingRitualPreview(props: WaitingFeedbackProps) {
  return <div className={WIDTH}><WaitingFeedback {...props} /></div>;
}

/** Message context only: no page shell, request or fabricated response. */
export function WaitingWithMessage(props: WaitingFeedbackProps) {
  return <div className={`${WIDTH} grid gap-6`}>
    <ol className={MESSAGE_LIST_CLASS}><MessageTurn role="user"><MessageText text={QUESTION[props.dict.locale]} /></MessageTurn></ol>
    <WaitingFeedback {...props} />
  </div>;
}

export function LiveWaitingPreview({ dict, status }: Readonly<{ dict: ChatDict; status: ChatStatus }>) {
  const messages: readonly UIMessage[] = [{ id: "waiting-preview", role: "user", parts: [{ type: "text", text: QUESTION[dict.locale] }] }];
  return <div className={WIDTH}><WaitingRitual dict={dict} status={status} messages={messages} /></div>;
}
