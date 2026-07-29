import { useCallback, useState } from "react";
import type { ChatDict } from "../../i18n";
import { ByokUpsell } from "../ByokUpsell";
import { LimitBanner } from "./LimitBanner";

type Props = Readonly<{ dict: ChatDict }>;

/** The D11 secondary affordance (#284 T8 touchpoint A) opens the value
 * explainer, never a bare login form — the highest-intent discovery moment
 * gets the journey, not a wall. */
function useExplainer() {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => { setOpen(true); }, []);
  return { open, show };
}

/**
 * D11: the anonymous daily budget is spent (issue #274 S1.8 X4). Same login
 * affordance as D8, but a visitor who never had a session is told the truth —
 * today's allowance ran out — instead of that their session expired. There is
 * nothing to resume, so the banner offers login, plus (#284 T8) the BYOK
 * journey: "use your own key" opens the value explainer.
 */
function D11Banner({ dict, onByok }: Props & Readonly<{ onByok: () => void }>) {
  return (
    <LimitBanner
      block="chat-budget-exhausted"
      message={dict.errorStates.d11Message}
      loginLabel={dict.errorStates.d11Login}
      secondary={{ label: dict.byok.d11UseOwnKey, onClick: onByok }}
    />
  );
}

export function BudgetExhausted({ dict }: Props) {
  const explainer = useExplainer();
  return (
    <>
      <D11Banner dict={dict} onByok={explainer.show} />
      {explainer.open ? <ByokUpsell dict={dict} /> : null}
    </>
  );
}
