import { useCallback, useState } from "react";
import type { AuthStatus } from "../../lib/auth/session";
import type { ChatSearch } from "./search";

/**
 * Open/closed state for the BYOK settings panel in the chat composer
 * (issue #284 Task 6 entry point). `?settings=byok` opens it on arrival —
 * that is the deep-link the whole Task 8 journey returns through, so a magic
 * link opened in a fresh tab still lands on the open panel.
 */
export interface ByokPanel {
  readonly open: boolean;
  readonly toggle: () => void;
  readonly auth: AuthStatus;
}

export function useByokPanel(search: ChatSearch, auth: AuthStatus): ByokPanel {
  const [open, setOpen] = useState(search.settings === "byok");
  const toggle = useCallback(() => { setOpen((value) => !value); }, []);
  return { open, toggle, auth };
}
