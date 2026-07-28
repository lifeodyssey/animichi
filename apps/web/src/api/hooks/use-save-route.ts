import { useCallback, useState } from "react";
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

export type SaveRouteStatus = "idle" | "saving" | "saved" | "error";

export interface SaveRouteMutation {
  readonly status: SaveRouteStatus;
  readonly save: (input: SaveRouteInput) => Promise<boolean>;
}

type SetStatus = (status: SaveRouteStatus) => void;

async function runSave(request: SaveRouteRequest, input: SaveRouteInput, setStatus: SetStatus): Promise<boolean> {
  setStatus("saving");
  const saved = await request(input).then(() => true, () => false);
  setStatus(saved ? "saved" : "error");
  return saved;
}

/** Save state for one card: a failure is retryable in place, never fatal. */
export function useSaveRoute(request: SaveRouteRequest = saveRouteRequest): SaveRouteMutation {
  const [status, setStatus] = useState<SaveRouteStatus>("idle");
  const save = useCallback((input: SaveRouteInput) => runSave(request, input, setStatus), [request]);
  return { status, save };
}
