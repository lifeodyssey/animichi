import type { ChatDict } from "../../i18n";
import { LimitBanner } from "./LimitBanner";

type Props = Readonly<{ dict: ChatDict }>;

/**
 * D11: the anonymous daily budget is spent (issue #274 S1.8 X4). Same login
 * affordance as D8, but a visitor who never had a session is told the truth —
 * today's allowance ran out — instead of that their session expired. There is
 * nothing to resume, so the banner offers login only.
 */
export function BudgetExhausted({ dict }: Props) {
  return (
    <LimitBanner
      block="chat-budget-exhausted"
      message={dict.errorStates.d11Message}
      loginLabel={dict.errorStates.d11Login}
    />
  );
}
