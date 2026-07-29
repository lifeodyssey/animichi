import type { Locale } from "../../../../i18n/locales";
import type { ChatErrorState } from "../../../../lib/chat/errorClassifier";
import type { ChatDict } from "../../i18n";
import { ByokUpsell } from "../ByokUpsell";
import { BudgetExhausted } from "./BudgetExhausted";
import { QuotaExhausted } from "./QuotaExhausted";
import { SessionExpired } from "./SessionExpired";
import { StreamInterruption, type InterruptionShape } from "./StreamInterruption";

export interface TurnFailureView {
  readonly state: ChatErrorState;
  /** D12 only: `quota_resets_at` as epoch ms, when the payload carried one. */
  readonly quotaResetsAtMs?: number;
  readonly onRetry: () => void;
  readonly onExpiredResume: () => void;
  readonly recovering: boolean;
}

type Props = Readonly<{ view: TurnFailureView | undefined; dict: ChatDict; locale: Locale }>;

function interruptionShape(state: ChatErrorState): InterruptionShape {
  if (state === "D5") return "D5";
  if (state === "D10") return "D10";
  return "D4";
}

/** Inline turn-failure surface: the D8/D11/D12 login banners or the D4/D5/D10 retry strip. */
function LimitState({ view, dict, locale }: Readonly<{ view: TurnFailureView; dict: ChatDict; locale: Locale }>) {
  if (view.state === "D12") return <QuotaExhausted dict={dict} locale={locale} resetsAtMs={view.quotaResetsAtMs} />;
  if (view.state === "D11") return <BudgetExhausted dict={dict} />;
  return <SessionExpired dict={dict} onResume={view.onExpiredResume} recovering={view.recovering} />;
}

/** D13 (#284 T8 touchpoint C): `byok_requires_login` enters the BYOK journey —
 * a short why-line plus the value explainer — not the D8 session story. */
function ByokRequiresLogin({ dict }: Readonly<{ dict: ChatDict }>) {
  return (
    <div className="chat-byok-gate">
      <p className="chat-byok-gate__message" role="alert">{dict.byok.errorRequiresLogin}</p>
      <ByokUpsell dict={dict} />
    </div>
  );
}

/** D14 (#284 T6-AC7): the provider refused the key. No retry — replaying the
 * turn replays the failure; the fix lives in the settings panel. */
function ByokRejected({ dict }: Readonly<{ dict: ChatDict }>) {
  return <div className="chat-byok-rejected" role="alert">{dict.byok.notAccepted}</div>;
}

const LIMIT_STATES = new Set<ChatErrorState>(["D8", "D11", "D12"]);

export function TurnFailure({ view, dict, locale }: Props) {
  if (!view) return null;
  if (view.state === "D13") return <ByokRequiresLogin dict={dict} />;
  if (view.state === "D14") return <ByokRejected dict={dict} />;
  if (LIMIT_STATES.has(view.state)) return <LimitState view={view} dict={dict} locale={locale} />;
  const shape = interruptionShape(view.state);
  return <StreamInterruption state={shape} dict={dict} onRetry={view.onRetry} recovering={view.recovering} />;
}
