import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/** Turn-level actions the fallback cards may trigger (spec §D chips/retries).
 * `sendWithOrigin` (optional for older providers/tests) also carries the
 * granted C4 coordinates as `origin_lat`/`origin_lng` on the request body. */
export interface ChatActions {
  readonly send: (text: string) => void;
  readonly regenerate: () => void;
  readonly sendWithOrigin?: (text: string, lat: number, lng: number) => void;
}

/** Origin-aware send that degrades to a plain send for older providers. */
export function sendWithOriginOf(
  actions: ChatActions,
): (text: string, lat: number, lng: number) => void {
  return actions.sendWithOrigin ?? ((text) => { actions.send(text); });
}

const ChatActionsContext = createContext<ChatActions | null>(null);

type ProviderProps = Readonly<{ actions: ChatActions; children: ReactNode }>;

/** Context instead of prop-drilling send/regenerate through the card tree. */
export function ChatActionsProvider({ actions, children }: ProviderProps) {
  return <ChatActionsContext.Provider value={actions}>{children}</ChatActionsContext.Provider>;
}

export function useChatActions(): ChatActions {
  const actions = useContext(ChatActionsContext);
  if (!actions) throw new Error("useChatActions must be used within a ChatActionsProvider");
  return actions;
}
