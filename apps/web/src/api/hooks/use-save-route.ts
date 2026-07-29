import { QueryClientContext } from "@tanstack/react-query";
import { useCallback, useContext, useRef, useState } from "react";
import type { SaveRouteInput, UserRoute } from "@seichijunrei/contract";
import { users } from "../orpc";

/** The one transport call behind both the in-chat save and create-on-login. */
export type SaveRouteRequest = (input: SaveRouteInput) => Promise<UserRoute>;

/**
 * `users.saveRoute` through the memoized oRPC client, so the UI never touches
 * the transport (component -> hook -> client, per `apps/web/AGENTS.md`).
 * Create-on-login calls this outside React, which is why it is a plain function
 * rather than a TanStack mutation: the auth-callback replay has no provider.
 */
export const saveRouteRequest: SaveRouteRequest = (input) => users().saveRoute.call(input);

/**
 * `unauthorized` sends the caller back through the login wall; `permanent` is a
 * 4xx that retrying cannot fix — offering "retry" there would be a dead loop;
 * `retryable` covers 5xx, transport failures and the transient 4xx codes.
 */
export type SaveRouteFailure = "unauthorized" | "permanent" | "retryable";
export type SaveRouteStatus = "idle" | "saving" | "saved" | SaveRouteFailure;

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status: unknown = (error as Record<string, unknown>).status;
  return typeof status === "number" ? status : undefined;
}

const TRANSIENT: ReadonlySet<number> = new Set([408, 425, 429]);

export function classifySaveFailure(error: unknown): SaveRouteFailure {
  const status = statusOf(error);
  if (status === 401 || status === 403) return "unauthorized";
  if (status === undefined || status >= 500 || TRANSIENT.has(status)) return "retryable";
  return status >= 400 ? "permanent" : "retryable";
}

export interface SaveRouteMutation {
  readonly status: SaveRouteStatus;
  readonly save: (input: SaveRouteInput) => Promise<SaveRouteStatus>;
}

type SetStatus = (status: SaveRouteStatus) => void;

function attempt(request: SaveRouteRequest, input: SaveRouteInput): Promise<SaveRouteStatus> {
  return request(input).then<SaveRouteStatus, SaveRouteStatus>(
    () => "saved",
    (error: unknown) => classifySaveFailure(error),
  );
}

async function runSave(request: SaveRouteRequest, input: SaveRouteInput, setStatus: SetStatus): Promise<SaveRouteStatus> {
  setStatus("saving");
  const outcome = await attempt(request, input);
  setStatus(outcome);
  return outcome;
}

/** A saved route changes `listRoutes`; invalidate it when a provider is present
 * (the chat page has one, a bare card render does not). */
function useInvalidateRoutes(): () => void {
  const client = useContext(QueryClientContext);
  return useCallback(() => {
    void client?.invalidateQueries({ queryKey: users().listRoutes.key() });
  }, [client]);
}

/** A tap while a save is in flight is dropped rather than queued. */
interface Busy { current: boolean }

async function guardedSave(busy: Busy, run: () => Promise<SaveRouteStatus>, invalidate: () => void): Promise<SaveRouteStatus> {
  if (busy.current) return "saving";
  busy.current = true;
  const outcome = await run().finally(() => { busy.current = false; });
  if (outcome === "saved") invalidate();
  return outcome;
}

/** Save state for one card: a failure is retryable in place, never fatal. A tap
 * while a save is in flight is dropped, so a double click cannot create two rows
 * against an endpoint that has no dedupe key. */
export function useSaveRoute(request: SaveRouteRequest = saveRouteRequest): SaveRouteMutation {
  const [status, setStatus] = useState<SaveRouteStatus>("idle");
  const busy = useRef(false);
  const invalidate = useInvalidateRoutes();
  const save = useCallback(
    (input: SaveRouteInput) => guardedSave(busy, () => runSave(request, input, setStatus), invalidate),
    [request, invalidate],
  );
  return { status, save };
}
