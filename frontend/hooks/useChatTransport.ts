"use client";

import { useEffect, useRef } from "react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { RUNTIME_URL, getAuthHeaders } from "../lib/api/client";
import type { Locale } from "../lib/i18n";

/**
 * Mutable state container shared between the transport closure and the hook.
 * Invisible to the React compiler's ref tracking since it is a plain object.
 */
const transportState: { sessionId: string | null; locale: Locale } = {
  sessionId: null,
  locale: "ja",
};

/** Singleton transport — session/locale passed via headers, not body.
 *  Body is reserved for the Vercel AI SDK's RequestData format. */
const chatTransport = new DefaultChatTransport({
  api: `${RUNTIME_URL}/v1/chat`,
  headers: async () => ({
    ...(await getAuthHeaders()),
    "x-session-id": transportState.sessionId ?? "",
    "x-locale": transportState.locale,
  }),
});

/**
 * Returns a stable DefaultChatTransport instance and keeps its
 * sessionId / locale values in sync with the latest props.
 */
export function useChatTransport(
  sessionId: string | null,
  locale: Locale,
): DefaultChatTransport<UIMessage> {
  // Keep transport state in sync via refs + effects.
  const sessionRef = useRef(sessionId);
  const localeRef = useRef(locale);

  useEffect(() => {
    sessionRef.current = sessionId;
    transportState.sessionId = sessionId;
  }, [sessionId]);

  useEffect(() => {
    localeRef.current = locale;
    transportState.locale = locale;
  }, [locale]);

  return chatTransport;
}
