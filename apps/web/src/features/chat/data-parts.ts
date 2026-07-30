import { ChatResponseDataPart } from "@animichi/contract";
import type { ChatDataPart } from "@animichi/contract";

/**
 * Trust boundary for streamed `data-response` parts: everything crossing from
 * the wire into rendering goes through the contract schema. Invalid payloads
 * return `null` so the UI can fall back instead of crashing.
 */
export function parseChatDataPart(data: unknown): ChatDataPart | null {
  const result = ChatResponseDataPart.safeParse(data);
  return result.success ? result.data : null;
}

/** The intent-first frame carries only `intent`; render a skeleton card for it. */
export function isIntentOnly(part: ChatDataPart): boolean {
  return part.message === undefined && part.data === undefined;
}
