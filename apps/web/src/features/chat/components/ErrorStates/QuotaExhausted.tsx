import type { Locale } from "../../../../i18n/locales";
import type { ChatDict } from "../../i18n";
import { LimitBanner } from "./LimitBanner";

type Props = Readonly<{ dict: ChatDict; locale: Locale; resetsAtMs: number | undefined }>;

/** The id a quota-locked composer points its `aria-describedby` at. */
export const QUOTA_BANNER_ID = "chat-quota-exhausted-banner";

/**
 * Name the reset instant in the reader's own timezone. "Today" is the server's
 * word, not the visitor's — a UTC-midnight reset is 09:00 tomorrow in JST, so
 * copy that only says "today" is wrong for most of the world.
 */
export function quotaNotice(dict: ChatDict, locale: Locale, resetsAtMs: number | undefined): string {
  if (resetsAtMs === undefined) return dict.errorStates.d12Message;
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(resetsAtMs);
  return dict.errorStates.d12MessageAt.replace("{time}", time);
}

/**
 * D12: this anonymous identity spent its own daily message quota (issue #282
 * S1.10). It shares D11's limit-banner shape — nothing is unmounted and login
 * is the single affordance — but it is not a dead end and not a failure: the
 * surface is healthy, only this visitor's allowance ran out. So it announces
 * as a `status`, not an `alert`, the composer stays mounted with the draft
 * intact, and the banner names when sending resumes on its own.
 */
export function QuotaExhausted({ dict, locale, resetsAtMs }: Props) {
  const message = quotaNotice(dict, locale, resetsAtMs);
  return (
    <LimitBanner block="chat-quota-exhausted" id={QUOTA_BANNER_ID} role="status" message={message} loginLabel={dict.errorStates.d12Login} />
  );
}
