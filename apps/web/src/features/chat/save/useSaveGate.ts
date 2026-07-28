import { useCallback, useEffect, useState } from "react";
import { useSaveRoute } from "../../../api/hooks/use-save-route";
import type { SaveRouteRequest, SaveRouteStatus } from "../../../api/hooks/use-save-route";
import { fetchAuthStatus, useAuthStatus } from "../../../lib/auth/session";
import type { AuthStatus } from "../../../lib/auth/session";
import { toSaveInput } from "./createOnLogin";
import { clearDeferredSave, pruneDeferredSave, writeDeferredSave } from "./deferredSave";
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

/** An injected status is already the answer — don't spend a `getSession` round
 * trip on it. Concurrent real lookups are deduped inside `fetchAuthStatus`. */
function useResolvedAuthStatus(override: AuthStatus | undefined): AuthStatus {
  const fetcher = useCallback(
    () => (override === undefined ? fetchAuthStatus() : Promise.resolve(override)),
    [override],
  );
  const detected = useAuthStatus(fetcher);
  return override ?? detected;
}

type Save = (input: ReturnType<typeof toSaveInput>) => Promise<SaveRouteStatus>;

/** A save rejected as unauthorized re-enters the wall with a fresh intent
 * rather than offering a retry that would fail identically. */
async function saveOrReWall(target: SaveTarget, save: Save, openLogin: () => void): Promise<void> {
  const outcome = await save(toSaveInput(target));
  if (outcome !== "unauthorized") return;
  writeDeferredSave(target);
  openLogin();
}

function act(action: SaveAction, target: SaveTarget | undefined, save: Save, openLogin: () => void): void {
  if (action === "none" || target === undefined) return;
  if (action === "save") return void saveOrReWall(target, save, openLogin);
  writeDeferredSave(target);
  openLogin();
}

function useActivate(action: SaveAction, target: SaveTarget | undefined, save: Save, openLogin: () => void) {
  return useCallback(() => { act(action, target, save, openLogin); }, [action, target, save, openLogin]);
}

/** Dismissing the wall is abandonment: drop the intent, or a later D8/D11 login
 * would silently save this card — possibly one #439 has already superseded. */
function useCloseLogin(setLoginOpen: (open: boolean) => void): () => void {
  return useCallback(() => {
    clearDeferredSave();
    setLoginOpen(false);
  }, [setLoginOpen]);
}

/** Save state plus the login wall for one route card. */
export function useSaveGate(target: SaveTarget | undefined, options: SaveGateOptions = {}): SaveGate {
  const detected = useResolvedAuthStatus(options.authStatus);
  const [loginOpen, setLoginOpen] = useState(false);
  const { status, save } = useSaveRoute(options.request);
  const action = saveAction(target, detected);
  const openLogin = useCallback(() => { setLoginOpen(true); }, []);
  useEffect(() => { pruneDeferredSave(); }, []);
  const activate = useActivate(action, target, save, openLogin);
  return { action, status, loginOpen, activate, closeLogin: useCloseLogin(setLoginOpen) };
}
