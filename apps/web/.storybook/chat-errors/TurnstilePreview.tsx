import { useState } from "react";
import { TurnstileGate } from "../../src/features/chat/components/TurnstileGate";
import { TurnstilePresentation, type TurnstileView } from "../../src/features/chat/components/TurnstilePresentation";
import { chatDictFor, type ChatDict } from "../../src/features/chat/i18n";
import { isLocale } from "../../src/i18n/locales";

/** Public test keys from Cloudflare; never a production key or a server secret. */
const TEST_KEYS = {
  interactive: "3x00000000000000000000FF",
  pass: "1x00000000000000000000AA",
  fail: "2x00000000000000000000AB",
} as const;
const TEST_NOTE = {
  zh: "预览使用 Cloudflare 官方测试控件，不会进入真实对话。",
  ja: "Cloudflare 公式テスト用ウィジェットのプレビューです。実際の会話には進みません。",
  en: "Preview uses Cloudflare's official test widget. It does not open a real conversation.",
} as const;
type Props = Readonly<{ dict: ChatDict; state?: TurnstileView; testCase?: keyof typeof TEST_KEYS }>;

export function turnstilePreviewDict(locale: unknown): ChatDict {
  return chatDictFor(typeof locale === "string" && isLocale(locale) ? locale : "zh");
}

function StateFixture({ dict, state = "checking" }: Omit<Props, "testCase">) {
  const [view, setView] = useState(state);
  return <TurnstilePresentation dict={dict} state={view} onRetry={() => { setView("checking"); }} />;
}

/** The real widget may emit a test token, but the preview neither stores nor verifies it. */
function leavePreviewOpen(): void { /* The server confirmation step is outside this preview. */ }

export function TurnstilePreview({ dict, state = "checking", testCase }: Props) {
  return <div className="grid w-[min(420px,calc(100vw_-_80px))] max-w-full gap-4">
    {testCase ? <TurnstileGate key={testCase} dict={dict} siteKey={TEST_KEYS[testCase]} onToken={leavePreviewOpen} onInvalid={leavePreviewOpen} /> : <StateFixture key={state} dict={dict} state={state} />}
    {testCase ? <p className="px-5 text-xs leading-5 text-muted-fg" data-preview-note>{TEST_NOTE[dict.locale]}</p> : null}
  </div>;
}
