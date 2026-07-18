import { resolveOrigin } from "../../api/config";

/** Chat talks to the Python agent through the `/v1` edge routes. */
export interface ChatApiConfig {
  readonly baseUrl: string;
  readonly chatUrl: string;
}

type Env = Readonly<Record<string, string | undefined>>;

export function resolveChatConfig(
  env: Env,
  location?: { readonly origin: string },
): ChatApiConfig {
  const baseUrl = env.VITE_AGENT_URL ?? resolveOrigin(env, location);
  return { baseUrl, chatUrl: `${baseUrl}/v1/chat` };
}

export function currentChatConfig(): ChatApiConfig {
  const location = typeof window === "undefined" ? undefined : window.location;
  return resolveChatConfig(import.meta.env, location);
}

export function healthzUrl(baseUrl: string): string {
  return `${baseUrl}/healthz`;
}

export function conversationMessagesUrl(baseUrl: string, sessionId: string): string {
  return `${baseUrl}/v1/conversations/${encodeURIComponent(sessionId)}/messages`;
}
