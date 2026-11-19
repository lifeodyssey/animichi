/**
 * Elements of a run's failure ledger (`catalog_runs.failures`) that the run
 * store does not write, as another version of the store or a hand edit could
 * leave them. The store must carry each one through a retry as the value it
 * was recorded as. None holds a number a JavaScript round trip would change,
 * so each comes back equal to what was recorded.
 */
export interface UnrecognisedLedgerElement {
  /** What keeps the store from recognising the element. */
  readonly label: string;
  /** A slug for run ids, one per case. */
  readonly key: string;
  readonly element: unknown;
}

export const UNRECOGNISED_LEDGER_ELEMENTS: readonly UnrecognisedLedgerElement[] = [
  {
    label: "an unknown stage",
    key: "unknown-stage",
    element: { bangumiId: "9", stage: "publish", reason: "a stage this store does not write" },
  },
  { label: "an element without a reason", key: "no-reason", element: { bangumiId: "7", stage: "enrich" } },
  { label: "an element with a numeric work id", key: "numeric-id", element: { bangumiId: 7, stage: "enrich", reason: "boom" } },
  { label: "a non-object element", key: "non-object", element: "stale-reclaimed" },
  {
    label: "a known stage with a key this store does not write",
    key: "extra-key",
    element: { bangumiId: "8", stage: "fetch", reason: "500", attempt: 2 },
  },
];
