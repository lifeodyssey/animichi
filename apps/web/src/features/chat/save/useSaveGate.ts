import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
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
  /** The wall dispatched a send — any dismissal that follows is the user
   * leaving to read their email, not a cancellation. */
  readonly markSendCommitted: () => void;
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

interface Wall {
  readonly loginOpen: boolean;
  readonly openLogin: () => void;
  readonly closeLogin: () => void;
  readonly markSendCommitted: () => void;
}

/**
 * The wall's own state. "The user committed to a send" is a **ref**, not state:
 * it never affects rendering, and `markSendCommitted` fires synchronously as
 * the request is dispatched. A state value would only reach the *next* render's
 * closures, so the dismissal handler already created for the current render
 * would still read `false` — silently clearing an intent the user is about to
 * use. The flag is set at dispatch, not on the reply, so the request's own
 * latency is not a window in which closing the modal destroys the intent.
 */
function useWall(): Wall {
  const [loginOpen, setLoginOpen] = useState(false);
  const committed = useRef(false);
  // Each fresh trip through the wall starts as "nothing committed yet".
  const openLogin = useCallback(() => { committed.current = false; setLoginOpen(true); }, []);
  const markSendCommitted = useCallback(() => { committed.current = true; }, []);
  return { loginOpen, openLogin, markSendCommitted, closeLogin: useCloseLogin(setLoginOpen, committed) };
}

/**
 * Dismissal is only abandonment **before** a send is dispatched: closing the
 * modal to go read the email is the mainline of the magic-link flow, and
 * clearing there would break create-on-login silently. Once a request is out
 * the intent survives — including while it is still in flight, and including a
 * send that ultimately failed, since keeping a stale intent costs nothing
 * (consume-once plus the TTL bound it) while clearing a live one loses the
 * user's work.
 */
function useCloseLogin(setLoginOpen: (open: boolean) => void, committed: RefObject<boolean>): () => void {
  return useCallback(() => {
    if (!committed.current) clearDeferredSave();
    setLoginOpen(false);
  }, [setLoginOpen, committed]);
}

/** Save state plus the login wall for one route card. */
export function useSaveGate(target: SaveTarget | undefined, options: SaveGateOptions = {}): SaveGate {
  const detected = useResolvedAuthStatus(options.authStatus);
  const wall = useWall();
  const { status, save } = useSaveRoute(options.request);
  const action = saveAction(target, detected);
  useEffect(() => { pruneDeferredSave(); }, []);
  const activate = useActivate(action, target, save, wall.openLogin);
  return { action, status, ...wall, activate };
}
