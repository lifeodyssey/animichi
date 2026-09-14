import { memo } from "react";
import type { ChatDict } from "../i18n";
import type { ConversationHistoryStatus } from "../use-conversation-history";
import type { HistoryReplayEntry } from "../lib/history-replay";
import { hasUnavailableHistory } from "../lib/history-replay";
import { historyReplayCopy } from "../history-replay-copy";
import { MESSAGE_LIST_CLASS, MessageText, MessageTurn } from "./MessagePresentation";
import { HistoryContent } from "./HistoryContent";
import { HistoryRestoreNotice } from "./HistoryRestoreNotice";

export interface HistoryListProps {
  readonly entries: readonly HistoryReplayEntry[];
  readonly dict: ChatDict;
  readonly status?: ConversationHistoryStatus;
  /** A new owner-supplied session resets local galleries and expanded places. */
  readonly sessionId?: string;
  readonly onRetry?: () => void;
  readonly onContinueDraft?: (draftId: string) => void;
}

function HistoryItem({ entry, dict, ready, onContinueDraft }: Pick<HistoryListProps, "dict" | "onContinueDraft"> & Readonly<{ entry: HistoryReplayEntry; ready: boolean }>) {
  return <MessageTurn role={entry.role}>
    {entry.content.trim() ? <MessageText text={entry.content} /> : null}
    {entry.blocks?.map((block) => <HistoryContent key={block.id} block={block} dict={dict} ready={ready} onContinueDraft={onContinueDraft} />)}
  </MessageTurn>;
}

function HistoryEntries({ entries, dict, sessionId, status, onContinueDraft }: HistoryListProps) {
  return <ol key={sessionId} className={`chat-history ${MESSAGE_LIST_CLASS} [&>.chat-message]:[animation:none]!`} aria-label={dict.historyFootprint}>
    {entries.map((entry, index) => <HistoryItem key={entry.id ?? `history-${String(index)}-${entry.role}`} entry={entry} dict={dict} ready={status === undefined || status === "success"} onContinueDraft={onContinueDraft} />)}
  </ol>;
}

/** Static replay: no live region or invented tool playback. Legacy plain-text callers still work. */
export const HistoryList = memo(function HistoryList(props: HistoryListProps) {
  const { entries, dict, status } = props, copy = historyReplayCopy(dict.locale);
  if (status === "idle" || (status === undefined && entries.length === 0)) return null;
  return <section className="relative grid w-full min-w-0 gap-5 text-fg" aria-label={copy.heading}>
    <p className="text-xs font-medium leading-5 text-muted-fg">{copy.heading}</p>
    <HistoryRestoreNotice {...props} status={status ?? "success"} hasEntries={entries.length > 0} partial={hasUnavailableHistory(entries)} />
    {entries.length > 0 ? <HistoryEntries {...props} /> : status === "success" ? <p className="text-sm leading-6 text-muted-fg">{copy.empty}</p> : null}
  </section>;
});
