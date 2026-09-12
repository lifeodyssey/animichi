import { useId } from "react";
import type { ChatDict } from "../i18n";
import { ByokSetupAction, ByokSetupFacts } from "./ByokSetupDetails";

type Props = Readonly<{ dict: ChatDict }>;

/** Explain provider billing and session-scoped key handling before sign-in.
 * The existing login callback leads to settings; email delivery is not setup. */
export function ByokUpsell({ dict }: Props) {
  const byok = dict.byok, id = useId(), costId = `${id}-cost`;
  return <section className="chat-byok-upsell grid min-w-0 gap-4 rounded-[20px] bg-card/60 p-4 text-sm leading-6 text-fg [overflow-wrap:anywhere]" aria-labelledby={id}>
    <div className="grid gap-1"><h3 id={id} className="chat-byok-upsell__title text-base font-semibold">{byok.upsellTitle}</h3><p className="text-pretty text-muted-fg">{byok.upsellBenefit}</p></div>
    <ByokSetupFacts byok={byok} costId={costId} />
    <ByokSetupAction byok={byok} describedBy={costId} />
  </section>;
}
