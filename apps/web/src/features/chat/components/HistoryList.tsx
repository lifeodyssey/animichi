import type { ChatDict } from "../i18n";
import type { HistoryEntry } from "../use-conversation-history";

/** A3: old pipelines collapse into a single footprint row per settled turn. */
export function FootprintRow({ intent }: Readonly<{ intent: string }>) {
  return (
    <p className="chat-footprint" data-intent={intent}>
      ✓ {intent}
    </p>
  );
}

function HistoryItem({ entry }: Readonly<{ entry: HistoryEntry }>) {
  return (
    <li className={`chat-message chat-message--${entry.role}`}>
      <p className="chat-bubble">{entry.content}</p>
      {entry.intent ? <FootprintRow intent={entry.intent} /> : null}
    </li>
  );
}

type Props = Readonly<{ entries: readonly HistoryEntry[]; dict: ChatDict }>;

export function HistoryList({ entries, dict }: Props) {
  if (entries.length === 0) return null;
  const items = entries.map((entry, index) => (
    <HistoryItem key={`history-${String(index)}-${entry.role}`} entry={entry} />
  ));
  return <ol className="chat-history" aria-label={dict.historyFootprint}>{items}</ol>;
}
