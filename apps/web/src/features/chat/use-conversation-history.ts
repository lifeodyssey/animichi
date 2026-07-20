import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { z } from "zod";
import { authHeaders } from "../../lib/auth/authSession";
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

export type ConversationHistoryStatus = "idle" | "loading" | "error" | "success";

export interface ConversationHistory {
  readonly status: ConversationHistoryStatus;
  readonly entries: readonly HistoryEntry[];
  readonly retry: () => void;
}

function toEntry(row: z.infer<typeof HistoryRow>): HistoryEntry {
  return { role: row.role, content: row.content, intent: row.response_data?.intent };
}

/** Anonymous when signed out (existing behaviour); adds a Bearer token once signed in. */
async function fetchHistory(baseUrl: string, sessionId: string): Promise<HistoryEntry[]> {
  const headers = await authHeaders();
  const response = await fetch(conversationMessagesUrl(baseUrl, sessionId), { headers });
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

function toStatus(
  query: { isSuccess: boolean; isError: boolean },
  enabled: boolean,
): ConversationHistoryStatus {
  if (!enabled) return "idle";
  if (query.isError) return "error";
  return query.isSuccess ? "success" : "loading";
}

/**
 * A3: restore a historical session via `GET /v1/conversations/{id}/messages`.
 * Failures are surfaced as an explicit error status — never as an empty,
 * writable-looking session.
 */
export function useConversationHistory(baseUrl: string, sessionId?: string): ConversationHistory {
  const query = useQuery(historyQueryOptions(baseUrl, sessionId));
  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);
  return { status: toStatus(query, sessionId !== undefined), entries: query.data ?? [], retry };
}
