import { useState } from "react";
import { ColdStart } from "../../src/features/chat/components/ColdStart";
import { chatDictFor, type ChatDict } from "../../src/features/chat/i18n";
import { isLocale } from "../../src/i18n/locales";

type Props = Readonly<{ dict: ChatDict; disabled?: boolean }>;
const PREVIEW_COPY = {
  zh: { label: "这句会作为你的消息发送", note: "当前预览只记录选择，不发送请求。" },
  ja: { label: "この内容をメッセージとして送信するよ", note: "このプレビューでは選択を記録するだけで、リクエストは送りません。" },
  en: { label: "This is the message you would send", note: "This preview records the selection without sending a request." },
} as const;

export function coldStartPreviewDict(locale: unknown): ChatDict {
  return chatDictFor(typeof locale === "string" && isLocale(locale) ? locale : "zh");
}

/** Local selection feedback makes the exact outgoing question reviewable without a mock answer. */
export function ColdStartPreview({ dict, disabled = false }: Props) {
  const [selected, setSelected] = useState<string>(), copy = PREVIEW_COPY[dict.locale];
  return <div className="grid w-[min(560px,calc(100vw_-_80px))] max-w-full gap-4">
    <ColdStart dict={dict} disabled={disabled || selected !== undefined} onChip={setSelected} />
    {selected ? <aside className="grid gap-2 rounded-2xl bg-muted p-4 text-sm leading-6 text-fg" role="status" data-preview-note><p className="text-xs text-muted-fg">{copy.label}</p><p>{selected}</p><p className="text-xs text-muted-fg">{copy.note}</p></aside> : null}
  </div>;
}
