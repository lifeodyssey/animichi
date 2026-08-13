import { type ApiOriginInput, resolveAgentBaseUrl } from "../../api/config";
import { currentRuntimeConfig } from "../../lib/runtime-config/provider";

/** Chat talks to the Python agent through the `/v1` edge routes. */
export interface ChatApiConfig {
  readonly baseUrl: string;
  readonly chatUrl: string;
}

export function resolveChatConfig(
  api: ApiOriginInput,
  location?: { readonly origin: string },
): ChatApiConfig {
  const baseUrl = resolveAgentBaseUrl(api, location);
  return { baseUrl, chatUrl: `${baseUrl}/v1/chat` };
}

export function currentChatConfig(): ChatApiConfig {
  const location = typeof window === "undefined" ? undefined : window.location;
  return resolveChatConfig(currentRuntimeConfig().api, location);
}

export function healthzUrl(baseUrl: string): string {
  return `${baseUrl}/healthz`;
}

export function conversationMessagesUrl(baseUrl: string, sessionId: string): string {
  return `${baseUrl}/v1/conversations/${encodeURIComponent(sessionId)}/messages`;
}
