import { ByokRequiresLogin } from "../../src/features/chat/components/ErrorStates/ByokRequiresLogin";
import { MESSAGE_LIST_CLASS, MessageText, MessageTurn } from "../../src/features/chat/components/MessagePresentation";
import { chatDictFor, type ChatDict } from "../../src/features/chat/i18n";
import { isLocale } from "../../src/i18n/locales";

type Props = Readonly<{ dict: ChatDict; withMessage?: boolean }>;
const MESSAGE = {
  zh: "四谷和新宿的地点都可以继续浏览。挑好想去的地方后，我们再一起安排。",
  ja: "四ツ谷と新宿のスポットは引き続き見られるよ。行きたい場所を選んだら、一緒に予定を考えよう。",
  en: "You can keep browsing the locations around Yotsuya and Shinjuku. Once you've picked a few, we can plan your visit.",
} as const;

/** Play functions use the same explicit locale as the rendered preview. */
export function byokLoginPreviewDict(locale: unknown): ChatDict {
  return chatDictFor(typeof locale === "string" && isLocale(locale) ? locale : "zh");
}

/** Only the preceding message is authored; login uses the existing Storybook auth boundary. */
export function ByokRequiresLoginPreview({ dict, withMessage }: Props) {
  return <div className="grid w-[min(452px,calc(100vw_-_80px))] max-w-full gap-6">
    {withMessage ? <ol className={MESSAGE_LIST_CLASS}><MessageTurn role="assistant"><MessageText text={MESSAGE[dict.locale]} /></MessageTurn></ol> : null}
    <ByokRequiresLogin dict={dict} />
  </div>;
}
