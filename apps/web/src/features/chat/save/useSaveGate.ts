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
  /** The wall dispatched a magic link — the dismissal that follows is the user
   * leaving to read their email, not a cancellation. */
  readonly markLinkSent: () => void;
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
  readonly markLinkSent: () => void;
}

/**
 * The wall's own state. "A link went out" is a **ref**, not state: it never
 * affects rendering, and React batches the form's effect with the dismissal
 * click — a state value would still read `false` inside the click handler that
 * flushed it, silently clearing an intent the user is about to use.
 */
function useWall(): Wall {
  const [loginOpen, setLoginOpen] = useState(false);
  const linkSent = useRef(false);
  // Each fresh trip through the wall starts as "no link sent yet".
  const openLogin = useCallback(() => { linkSent.current = false; setLoginOpen(true); }, []);
  const markLinkSent = useCallback(() => { linkSent.current = true; }, []);
  return { loginOpen, openLogin, markLinkSent, closeLogin: useCloseLogin(setLoginOpen, linkSent) };
}

/**
 * Dismissal is only abandonment **before** a link goes out: closing the modal to
 * go read the email is the mainline of the magic-link flow, and clearing there
 * would break create-on-login silently. Once a link is dispatched the intent
 * survives; the surprise-save risk that motivated clearing is already covered by
 * consume-once plus the TTL.
 */
function useCloseLogin(setLoginOpen: (open: boolean) => void, linkSent: RefObject<boolean>): () => void {
  return useCallback(() => {
    if (!linkSent.current) clearDeferredSave();
    setLoginOpen(false);
  }, [setLoginOpen, linkSent]);
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
