import type { ComponentProps } from "react";
import { ChatInput } from "../../src/features/chat/components/ChatInput";
import { QuotaExhausted } from "../../src/features/chat/components/ErrorStates/QuotaExhausted";
import { MESSAGE_LIST_CLASS, MessageText, MessageTurn } from "../../src/features/chat/components/MessagePresentation";
import { chatDictFor, type ChatDict } from "../../src/features/chat/i18n";
import { isLocale } from "../../src/i18n/locales";

export type QuotaExhaustedPreviewProps = ComponentProps<typeof QuotaExhausted> & Readonly<{
  withMessage?: boolean; withComposer?: boolean; onSend: (text: string) => void;
}>;
const WIDTH = "w-[min(452px,calc(100vw_-_80px))] max-w-full";
const COPY = {
  zh: { answer: "四谷和新宿的地点都可以继续浏览。挑好想去的地方后，我们再一起安排。", draft: "我还想看看代代木附近的取景地。" },
  ja: { answer: "四ツ谷と新宿のスポットは引き続き見られるよ。行きたい場所を選んだら、一緒に予定を考えよう。", draft: "代々木の近くの舞台も見たい。" },
  en: { answer: "You can keep browsing the locations around Yotsuya and Shinjuku. Once you've picked a few, we can plan your visit.", draft: "I'd also like to see the locations around Yoyogi." },
} as const;

export function quotaPreviewDraft(dict: ChatDict): string {
  return COPY[dict.locale].draft;
}

/** Decorators update rendered args; play functions must read the selected global. */
export function quotaPreviewDict(locale: unknown): ChatDict {
  return chatDictFor(typeof locale === "string" && isLocale(locale) ? locale : "zh");
}

function ExistingMessage({ dict }: Readonly<{ dict: ChatDict }>) {
  return <ol className={MESSAGE_LIST_CLASS}><MessageTurn role="assistant"><MessageText text={COPY[dict.locale].answer} /></MessageTurn></ol>;
}

/** Explicit quota fixture: editing stays live, sending stays locked throughout login. */
export function QuotaExhaustedPreview(props: QuotaExhaustedPreviewProps) {
  return <div className={`${WIDTH} grid gap-6`}>
    {props.withMessage ? <ExistingMessage dict={props.dict} /> : null}
    <QuotaExhausted dict={props.dict} locale={props.locale} resetsAtMs={props.resetsAtMs} />
    {props.withComposer ? <ChatInput dict={props.dict} disabled={false} quotaLocked onSend={props.onSend} /> : null}
  </div>;
}
