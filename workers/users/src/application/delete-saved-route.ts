import type { DeleteSavedRouteInput, DeleteSavedRouteResult } from "@animichi/contract";
import { savedRouteNotFound, savedRouteNotOwned } from "../lib/errors";

/** Outcome of one owner-predicated atomic delete, classified without exposing the owner. */
export type DeleteOwnedOutcome =
  | { readonly kind: "deleted" }
  | { readonly kind: "missing" }
  | { readonly kind: "not_owned" };

/** The one outbound capability DeleteSavedRoute needs from the Neon store. */
export interface DeleteSavedRouteStore {
  deleteOwned(userId: string, id: string): Promise<DeleteOwnedOutcome>;
}

/** Redacted outcome label — never the id, never the owner. */
export type DeleteSavedRouteOutcomeLabel = "deleted" | "rejected" | "missing" | "failure";

/** Redacted observability record: outcome and duration only. */
export interface DeleteSavedRouteObservability {
  outcome: DeleteSavedRouteOutcomeLabel;
  duration_ms: number;
}

export interface DeleteSavedRouteObserver {
  record(record: DeleteSavedRouteObservability): void;
}

export interface DeleteSavedRouteOptions {
  observer?: DeleteSavedRouteObserver;
}

const noopObserver: DeleteSavedRouteObserver = { record: () => undefined };

/** Delete one owned saved route atomically. The action owns the ownership
 * mapping and the stable SAVED_ROUTE_* errors; the store owns the SQL. */
export async function deleteSavedRoute(
  store: DeleteSavedRouteStore,
  userId: string,
  input: DeleteSavedRouteInput,
  opts: DeleteSavedRouteOptions = {},
): Promise<DeleteSavedRouteResult> {
  const label = await runDelete(opts.observer ?? noopObserver, store, userId, input.id);
  return respond(label, input.id);
}

async function runDelete(
  observer: DeleteSavedRouteObserver,
  store: DeleteSavedRouteStore,
  userId: string,
  id: string,
): Promise<DeleteSavedRouteOutcomeLabel> {
  const startedAt = Date.now();
  try {
    const label = classify(await store.deleteOwned(userId, id));
    record(observer, label, startedAt);
    return label;
  } catch (error) {
    record(observer, "failure", startedAt);
    throw error;
  }
}

function classify(outcome: DeleteOwnedOutcome): DeleteSavedRouteOutcomeLabel {
  return outcome.kind === "deleted" ? "deleted" : outcome.kind === "missing" ? "missing" : "rejected";
}

function record(
  observer: DeleteSavedRouteObserver,
  outcome: DeleteSavedRouteOutcomeLabel,
  startedAt: number,
): void {
  try {
    observer.record({ outcome, duration_ms: Date.now() - startedAt });
  } catch {
    // Observability must never change delete semantics.
  }
}

function respond(label: DeleteSavedRouteOutcomeLabel, id: string): DeleteSavedRouteResult {
  if (label === "deleted") return { deleted: true };
  if (label === "missing") throw savedRouteNotFound(id);
  throw savedRouteNotOwned(id);
}
