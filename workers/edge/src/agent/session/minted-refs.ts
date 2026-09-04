/**
 * The refs one RUN minted, and how a retried alarm gets them back (#1279).
 *
 * A ref is the handle the model is given instead of the rows
 * (`turn-catalog-session.ts`), and it only has to survive from the step that
 * minted it to a later step of the same run. That was true until a crash: a
 * settled step is replayed from `run_steps.result` WITHOUT calling `execute`
 * (`turn-step.ts`), so the map the first attempt filled is gone and the
 * `plan_route` naming `search:2:1` reads back `stale_ref`.
 *
 * So the mint rides the step. `StepResult.minted` carries the ref AND the
 * payload behind it — the payload cannot be rebuilt from the outcome the model
 * reads, which is a ref and two numbers by design — and a retry puts every one
 * of them back before the loop resumes. It sits beside `details` rather than
 * inside it for two reasons: `details` is what the model reads back off the
 * transcript and what the SD-9 `tool-output-available` frame publishes, and
 * rows belong in neither.
 *
 * `SelectionRecord` (#1288) is the same move for the one step no model asks
 * for, made first and for its own path; this is the general form.
 *
 * IT STORES THE ROWS TWICE — here for the replay, and again in the answer's
 * `messages.response_data` for the web — and that is the cheaper of the two
 * prices. The other one is asking the catalog again on the retry, which is the
 * re-execution the `(run_id, step_index)` key exists to prevent.
 */
import { isJsonRecord } from "../json-record.ts";
import type { ItineraryPayload, SearchResultPayload } from "../tools/catalog-tool-session.ts";
import { storedItinerary, storedSearchResult } from "../tools/stored-payload.ts";
import type { PersistedStep } from "./turn-store.ts";

/** One search result, under the ref its step handed the model. */
export interface SearchMint {
  readonly kind: "search";
  readonly ref: string;
  readonly payload: SearchResultPayload;
}

/** One planned route, under its own ref. */
export interface RouteMint {
  readonly kind: "route";
  readonly ref: string;
  readonly payload: ItineraryPayload;
}

/** One ref a step minted, with the payload it names. */
export type StepMint = SearchMint | RouteMint;

/**
 * The run's ref registry, as the step machinery reads and rebuilds it —
 * fulfilled by the same object the tools mint through.
 */
export interface MintedRefs {
  /** How many refs this run has minted so far — the mark a step takes before
   * it runs, so it can name what it added afterwards. */
  readonly mintCount: number;
  /** The refs minted after that mark, in mint order. */
  mintedSince(mark: number): readonly StepMint[];
  /** Put back the refs one settled step minted: same ref, same payload, and
   * the sequence advanced past each so a new ref cannot collide with one. */
  remint(mints: readonly StepMint[]): void;
}

/** One mint as the column holds it, or null when the value is not one. */
function mintIn(value: unknown): StepMint | null {
  if (!isJsonRecord(value) || typeof value.ref !== "string") return null;
  if (value.kind === "search") return searchMint(value.ref, value.payload);
  return value.kind === "route" ? routeMint(value.ref, value.payload) : null;
}

function searchMint(ref: string, value: unknown): SearchMint | null {
  const payload = storedSearchResult(value);
  return payload === null ? null : { kind: "search", ref, payload };
}

function routeMint(ref: string, value: unknown): RouteMint | null {
  const payload = storedItinerary(value);
  return payload === null ? null : { kind: "route", ref, payload };
}

/**
 * The mints a settled result carries.
 *
 * A result written before this rode along carries none, and reads as none: the
 * step already ran and the catalog already answered, so the honest degradation
 * is the `stale_ref` this card closes rather than a re-execution.
 */
export function mintsIn(value: unknown): StepMint[] {
  if (!Array.isArray(value)) return [];
  return value.map(mintIn).filter((mint): mint is StepMint => mint !== null);
}

/**
 * Put every settled step's refs back, in `step_index` order.
 *
 * The order is the point of the sort: `searchResults` is read in the order the
 * tools stored them — that is what tells an answer WHICH search it is about
 * (#1283) — so a rehydration that filed them by whatever order the driver
 * returned would change the answer a retry gives.
 */
export function rehydrateRefs(refs: MintedRefs, steps: readonly PersistedStep[]): void {
  const settled = [...steps].sort((left, right) => left.stepIndex - right.stepIndex);
  for (const step of settled) refs.remint(mintsIn(step.result?.minted));
}
