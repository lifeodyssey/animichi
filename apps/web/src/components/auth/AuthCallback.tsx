import { useEffect } from "react";
import { useDict } from "../../i18n/context";
import type { Dict } from "../../i18n/dictionaries";
import type { DeferredReplayOutcome } from "../../features/chat/save/createOnLogin";
import { getAuthToken } from "../../lib/auth/authSession";
import { useAuthCallback } from "./useAuthCallback";
import type { AuthCallbackSession, AuthCallbackState } from "./useAuthCallback";

import type { SessionMigrationOutcome } from "../../lib/auth/sessionMigration";

type MessageState = Extract<AuthCallbackState, "pending" | "error">;

function CallbackMessage({ state }: Readonly<{ state: MessageState }>) {
  const auth = useDict().auth;
  const role = state === "error" ? "alert" : "status";
  const text = state === "error" ? auth.callback_error : auth.callback_pending;
  return <p className="auth-callback__message" role={role}>{text}</p>;
}

type FailureProps = Readonly<{ auth: Dict["auth"]; session: AuthCallbackSession }>;

type ActionProps = Readonly<{ label: string; className: string; onClick: () => void }>;

function CallbackAction({ label, className, onClick }: ActionProps) {
  return <button type="button" className={className} onClick={onClick}>{label}</button>;
}

/**
 * The login succeeded but create-on-login did not. The intent is still on this
 * origin, so the visitor gets a retry here plus the explicit fallback — never a
 * silent "done" that lets the save reappear on some later login.
 */
function SaveFailure({ auth, session }: FailureProps) {
  return (
    <div className="auth-callback__save-failed" role="alert">
      <p className="auth-callback__message">{auth.callback_save_failed}</p>
      <CallbackAction label={auth.callback_save_retry} className="auth-callback__retry" onClick={session.retrySave} />
      <CallbackAction label={auth.callback_save_skip} className="auth-callback__skip" onClick={session.dismissSave} />
    </div>
  );
}

/**
 * The claim did not land (#507 review P1-3). Same shape and classes as the
 * save failure above, deliberately: `apps/web` has no telemetry sink, so this
 * screen is the only real outlet, and reusing the designed surface keeps it a
 * variant rather than a new pattern (the design sync has no callback mock).
 * `nothing-migrated` gets its own copy — that is the cross-device case, where
 * the work is on the other browser and a retry here cannot reach it.
 */
function MigrationFailure({ auth, session }: FailureProps) {
  const text = session.migration === "nothing-migrated" ? auth.callback_migration_missing : auth.callback_migration_failed;
  return (
    <div className="auth-callback__save-failed" role="alert">
      <p className="auth-callback__message">{text}</p>
      <CallbackAction label={auth.callback_migration_retry} className="auth-callback__retry" onClick={session.retryMigration} />
      <CallbackAction label={auth.callback_migration_skip} className="auth-callback__skip" onClick={session.dismissMigration} />
    </div>
  );
}

export interface AuthCallbackProps {
  readonly onDone: () => void;
  /** #480 P1-2 ruling: when the login carried a BYOK deep-link (`next`), a
   * failed create-on-login replay must NOT strand the visitor here — the
   * intent is restored to storage for a later login, and navigation to the
   * return target still happens. Without a return intent, today's blocking
   * retry/skip surface is preserved. */
  readonly hasReturnIntent?: boolean;
  /** The login's return target named a chat session, so a migration that moved
   * nothing is an anomaly rather than a normal no-op (#507 review P1-2). */
  readonly expectsMigration?: boolean;
  readonly establish?: () => Promise<string | undefined>;
  readonly replay?: () => Promise<DeferredReplayOutcome>;
  readonly migrate?: (token: string) => Promise<SessionMigrationOutcome>;
}

function shouldNavigate(state: AuthCallbackState, hasReturnIntent: boolean): boolean {
  return state === "done" || (state === "save-failed" && hasReturnIntent);
}

function useDoneEffect(state: AuthCallbackState, onDone: () => void, hasReturnIntent: boolean): void {
  useEffect(() => {
    if (shouldNavigate(state, hasReturnIntent)) onDone();
  }, [state, onDone, hasReturnIntent]);
}

function CallbackBody({ session }: Readonly<{ session: AuthCallbackSession }>) {
  const auth = useDict().auth;
  if (session.state === "done") return null;
  if (session.state === "save-failed") return <SaveFailure auth={auth} session={session} />;
  if (session.state === "migration-failed") return <MigrationFailure auth={auth} session={session} />;
  return <CallbackMessage state={session.state} />;
}

/** `/auth/callback` body: redeems the session, replays a deferred save, then
 * hands control back to the route — unless that replay failed AND no return
 * intent is waiting (see `hasReturnIntent`). */
export function AuthCallback(
  { onDone, hasReturnIntent = false, expectsMigration = false, establish = getAuthToken, replay, migrate }: AuthCallbackProps,
) {
  const session = useAuthCallback(establish, replay, migrate, expectsMigration);
  useDoneEffect(session.state, onDone, hasReturnIntent);
  return <CallbackBody session={session} />;
}
