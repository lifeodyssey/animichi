import { QueryClientContext } from "@tanstack/react-query";
import { useCallback, useContext, useRef, useState } from "react";
import { IDEMPOTENCY_KEY_HEADER, type SaveSavedRouteInput, type SavedRoute } from "@animichi/contract";
import { users } from "../orpc";

/** The one transport call behind both the in-chat save and CompleteDeferredSave. */
export type SaveSavedRouteRequest = (input: SaveSavedRouteInput) => Promise<SavedRoute>;

/** FNV-1a 64-bit hash (BigInt): deterministic, dependency-free, and bounded,
 * so the same create payload yields the same Idempotency-Key across a reload
 * and across tabs (AC6). Not a security primitive. */
function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash = (hash ^ BigInt(input.charCodeAt(i))) & 0xffffffffffffffffn;
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/** The retry-safe key for a create: a stable hash of the canonical payload, so
 * double clicks, a reload, and a second tab re-sending the same route all reuse
 * one server-side idempotency row (issue #1011 AC6). */
export function idempotencyKeyFor(input: SaveSavedRouteInput): string {
  const canonical = JSON.stringify({
    v: 1, title: input.title, status: input.status, point_ids: input.point_ids,
  });
  return fnv1a64(canonical);
}

/**
 * users.saveSavedRoute through the memoized oRPC client, so the UI never
 * touches the transport (component -> hook -> client, per apps/web/AGENTS.md).
 * CompleteDeferredSave calls this outside React, which is why it is a plain
 * function rather than a TanStack mutation: the auth-callback replay has no
 * provider. Every create carries the payload-derived Idempotency-Key header so
 * reload and multi-tab retries dedupe server-side (issue #1011 AC6).
 */
export const saveSavedRouteRequest: SaveSavedRouteRequest = (input) =>
  users().saveSavedRoute.call(input, {
    context: { headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKeyFor(input) } },
  });

/**
 * unauthorized sends the caller back through the login wall; permanent is a
 * 4xx that retrying cannot fix — offering retry there would be a dead loop;
 * retryable covers 5xx, transport failures and the transient 4xx codes.
 */
export type SaveSavedRouteFailure = "unauthorized" | "permanent" | "retryable";
export type SaveSavedRouteStatus = "idle" | "saving" | "saved" | SaveSavedRouteFailure;

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status: unknown = (error as Record<string, unknown>).status;
  return typeof status === "number" ? status : undefined;
}

const TRANSIENT: ReadonlySet<number> = new Set([408, 425, 429]);

export function classifySaveFailure(error: unknown): SaveSavedRouteFailure {
  const status = statusOf(error);
  if (status === 401 || status === 403) return "unauthorized";
  if (status === undefined || status >= 500 || TRANSIENT.has(status)) return "retryable";
  return status >= 400 ? "permanent" : "retryable";
}

export interface SaveSavedRouteMutation {
  readonly status: SaveSavedRouteStatus;
  readonly save: (input: SaveSavedRouteInput) => Promise<SaveSavedRouteStatus>;
}

type SetStatus = (status: SaveSavedRouteStatus) => void;

function attempt(request: SaveSavedRouteRequest, input: SaveSavedRouteInput): Promise<SaveSavedRouteStatus> {
  return request(input).then<SaveSavedRouteStatus, SaveSavedRouteStatus>(
    () => "saved",
    (error: unknown) => classifySaveFailure(error),
  );
}

async function runSave(request: SaveSavedRouteRequest, input: SaveSavedRouteInput, setStatus: SetStatus): Promise<SaveSavedRouteStatus> {
  setStatus("saving");
  const outcome = await attempt(request, input);
  setStatus(outcome);
  return outcome;
}

/** A saved route changes listSavedRoutes; invalidate it when a provider is
 * present (the chat page has one, a bare card render does not). */
function useInvalidateSavedRoutes(): () => void {
  const client = useContext(QueryClientContext);
  return useCallback(() => {
    void client?.invalidateQueries({ queryKey: users().listSavedRoutes.key() });
  }, [client]);
}

/** A tap while a save is in flight is dropped rather than queued. */
interface Busy { current: boolean }

async function guardedSave(busy: Busy, run: () => Promise<SaveSavedRouteStatus>, invalidate: () => void): Promise<SaveSavedRouteStatus> {
  if (busy.current) return "saving";
  busy.current = true;
  const outcome = await run().finally(() => { busy.current = false; });
  if (outcome === "saved") invalidate();
  return outcome;
}

/** Save state for one card: a failure is retryable in place, never fatal. A tap
 * while a save is in flight is dropped, so a double click cannot create two rows
 * against an endpoint that has no dedupe key. */
export function useSavedRoute(request: SaveSavedRouteRequest = saveSavedRouteRequest): SaveSavedRouteMutation {
  const [status, setStatus] = useState<SaveSavedRouteStatus>("idle");
  const busy = useRef(false);
  const invalidate = useInvalidateSavedRoutes();
  const save = useCallback(
    (input: SaveSavedRouteInput) => guardedSave(busy, () => runSave(request, input, setStatus), invalidate),
    [request, invalidate],
  );
  return { status, save };
}
