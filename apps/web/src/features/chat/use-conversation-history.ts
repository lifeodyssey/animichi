import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { conversationMessagesUrl } from "./config";

const HistoryRow = z.object({
  role: z.string(),
  content: z.string(),
  response_data: z.object({ intent: z.string().optional() }).nullable().optional(),
});

const HistoryPayload = z.object({ messages: z.array(HistoryRow) });

export interface HistoryEntry {
  readonly role: string;
  readonly content: string;
  readonly intent?: string;
}

function toEntry(row: z.infer<typeof HistoryRow>): HistoryEntry {
  return { role: row.role, content: row.content, intent: row.response_data?.intent };
}

async function fetchHistory(baseUrl: string, sessionId: string): Promise<HistoryEntry[]> {
  const response = await fetch(conversationMessagesUrl(baseUrl, sessionId));
  if (!response.ok) throw new Error(`messages responded ${String(response.status)}`);
  const payload: unknown = await response.json();
  return HistoryPayload.parse(payload).messages.map(toEntry);
}

function historyQueryOptions(baseUrl: string, sessionId?: string) {
  return {
    queryKey: ["chat", "history", baseUrl, sessionId],
    queryFn: () => fetchHistory(baseUrl, sessionId ?? ""),
    enabled: sessionId !== undefined,
  };
}

/** A3: restore a historical session via `GET /v1/conversations/{id}/messages`. */
export function useConversationHistory(
  baseUrl: string,
  sessionId?: string,
): readonly HistoryEntry[] {
  const query = useQuery(historyQueryOptions(baseUrl, sessionId));
  return query.data ?? [];
}
