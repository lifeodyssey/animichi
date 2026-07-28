import { useCallback, useState } from "react";
import { useSaveRoute } from "../../../api/hooks/use-save-route";
import type { SaveRouteRequest, SaveRouteStatus } from "../../../api/hooks/use-save-route";
import { useAuthStatus } from "../../../lib/auth/session";
import type { AuthStatus } from "../../../lib/auth/session";
import { toSaveInput } from "./createOnLogin";
import { writeDeferredSave } from "./deferredSave";
import type { SaveTarget } from "./saveTarget";

/** What a 「保存する」 tap does: nothing, open the login wall, or save. */
export type SaveAction = "none" | "login" | "save";

/**
 * The **single** login-wall predicate (P5). Nothing else in the chat flow may
 * open `LoginModal` proactively, so the invariant "no happy-path step opens the
 * dialog before the save tap" reduces to this one function. An unresolved auth
 * status is deliberately inert: opening the wall for a caller who turns out to
 * be signed in would be a false interruption.
 */
export function saveAction(target: SaveTarget | undefined, status: AuthStatus): SaveAction {
  if (target === undefined || target.pointIds.length === 0) return "none";
  if (status === "authenticated") return "save";
  return status === "anonymous" ? "login" : "none";
}

export interface SaveGate {
  readonly action: SaveAction;
  readonly status: SaveRouteStatus;
  readonly loginOpen: boolean;
  readonly activate: () => void;
  readonly closeLogin: () => void;
}

/** Injectable for tests; production callers rely on the defaults. */
export interface SaveGateOptions {
  readonly authStatus?: AuthStatus;
  readonly request?: SaveRouteRequest;
}

type Save = (input: ReturnType<typeof toSaveInput>) => Promise<boolean>;

function act(action: SaveAction, target: SaveTarget | undefined, save: Save, openLogin: () => void): void {
  if (action === "none" || target === undefined) return;
  if (action === "save") return void save(toSaveInput(target));
  writeDeferredSave(target);
  openLogin();
}

function useActivate(action: SaveAction, target: SaveTarget | undefined, save: Save, openLogin: () => void) {
  return useCallback(() => { act(action, target, save, openLogin); }, [action, target, save, openLogin]);
}

/** Save state plus the login wall for one route card. */
export function useSaveGate(target: SaveTarget | undefined, options: SaveGateOptions = {}): SaveGate {
  const detected = useAuthStatus();
  const [loginOpen, setLoginOpen] = useState(false);
  const { status, save } = useSaveRoute(options.request);
  const action = saveAction(target, options.authStatus ?? detected);
  const openLogin = useCallback(() => { setLoginOpen(true); }, []);
  const closeLogin = useCallback(() => { setLoginOpen(false); }, []);
  return { action, status, loginOpen, activate: useActivate(action, target, save, openLogin), closeLogin };
}
