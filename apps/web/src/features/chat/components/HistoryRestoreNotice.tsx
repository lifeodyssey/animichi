import { Button } from "animal-island-ui-tailwind/button";
import type { ChatDict } from "../i18n";
import type { ConversationHistoryStatus } from "../use-conversation-history";
import { historyReplayCopy } from "../history-replay-copy";

interface Props {
  readonly dict: ChatDict;
  readonly status: ConversationHistoryStatus;
  readonly hasEntries: boolean;
  readonly partial: boolean;
  readonly onRetry?: () => void;
}

const RETRY = "[min-height:44px]! [height:auto]! [padding:10px_14px]! [font-size:14px]! [white-space:normal]! [--animal-text-color:var(--color-primary-strong)] [--animal-bg-color-secondary:var(--color-primary-soft)] focus-visible:[outline-color:var(--color-primary-strong)] motion-reduce:transition-none";

function LoadingHistory({ dict, hasEntries }: Pick<Props, "dict" | "hasEntries">) {
  const copy = historyReplayCopy(dict.locale);
  return <div role="status" className="grid gap-5"><p className="text-sm leading-6 text-muted-fg">{hasEntries ? copy.refreshing : copy.loading}</p>
    {hasEntries ? null : <div aria-hidden="true" className="grid gap-6 py-1 motion-safe:animate-pulse motion-reduce:animate-none"><div className="ml-auto h-14 w-3/4 rounded-[22px] rounded-tr-md bg-primary-soft" /><div className="grid gap-3"><span className="h-3 w-4/5 rounded-full bg-border-soft" /><span className="h-3 w-2/3 rounded-full bg-border-soft" /><span className="h-3 w-1/2 rounded-full bg-border-soft" /></div></div>}
  </div>;
}

function feedbackCopy({ dict, status, hasEntries, partial }: Props) {
  const copy = historyReplayCopy(dict.locale);
  if (partial && status === "success") return { title: copy.partial, hint: copy.partialHint };
  if (hasEntries) return { title: copy.refreshFailed, hint: undefined };
  return { title: copy.failed, hint: copy.failedHint };
}

export function HistoryRestoreNotice(props: Props) {
  const { dict, status, hasEntries, partial, onRetry } = props, copy = historyReplayCopy(dict.locale);
  if (status === "loading") return <LoadingHistory dict={dict} hasEntries={hasEntries} />;
  if (status !== "error" && !partial) return null;
  const { title, hint } = feedbackCopy(props);
  return <div className="grid justify-items-start gap-1.5"><div role={status === "error" ? "alert" : "status"} className="grid gap-1 text-sm leading-6"><p className="font-bold text-fg">{title}</p>{hint ? <p className="text-muted-fg">{hint}</p> : null}</div>
    {onRetry ? <Button type="text" htmlType="button" className={RETRY} onClick={() => { onRetry(); }}>{copy.retry}</Button> : null}
  </div>;
}
