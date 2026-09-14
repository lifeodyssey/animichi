import { ByokUpsell } from "../../src/features/chat/components/ByokUpsell";
import { BudgetExhausted } from "../../src/features/chat/components/ErrorStates/BudgetExhausted";
import { chatDictFor, type ChatDict } from "../../src/features/chat/i18n";
import { isLocale } from "../../src/i18n/locales";

type Props = Readonly<{ dict: ChatDict; inBudget?: boolean }>;

/** Story-specific globals override the Chinese review default. */
export function byokPreviewDict(locale: unknown): ChatDict {
  return chatDictFor(typeof locale === "string" && isLocale(locale) ? locale : "zh");
}

/** Both modes render existing components with their real local disclosure state. */
export function ByokUpsellPreview({ dict, inBudget }: Props) {
  return <div className="w-[min(452px,calc(100vw_-_80px))] max-w-full">
    {inBudget ? <BudgetExhausted dict={dict} /> : <ByokUpsell dict={dict} />}
  </div>;
}
