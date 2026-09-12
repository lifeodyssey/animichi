import type { UIMessage } from "ai";
import type { HistoryEntry } from "../use-conversation-history";

/* The header follows the topic instead of a fixed "new journey" label: the
 * first thing the visitor asked, single-lined and capped so it stays one row.
 * Restored history wins — it holds the older half of a continued session. */
const TITLE_LIMIT = 24;

export function shortenTitle(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT).trimEnd()}…` : line;
}

function userText(message: UIMessage): string {
  return message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function liveTopic(messages: readonly UIMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  return first === undefined ? "" : userText(first);
}

/** The journey title, or undefined while nobody has said anything yet — the
 * header falls back to its "new journey" label then. */
export function journeyTitle(history: readonly HistoryEntry[], messages: readonly UIMessage[]): string | undefined {
  const raw = history.find((entry) => entry.role === "user")?.content ?? liveTopic(messages);
  const title = shortenTitle(raw);
  return title === "" ? undefined : title;
}
