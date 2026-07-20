import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/** Turn-level actions the fallback cards may trigger (spec §D chips/retries). */
export interface ChatActions {
  readonly send: (text: string) => void;
  readonly regenerate: () => void;
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
