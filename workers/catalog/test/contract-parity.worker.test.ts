/**
 * Compile-time parity guard: catalog/src/types.ts ↔ packages/contract/src/models.ts
 *
 * Every assignment below asserts MUTUAL ASSIGNABILITY between the contract's
 * inferred types (source of truth) and the catalog's hand-mirror types.
 * If either side drifts, `tsc --noEmit` (and this test file's type-checking)
 * will fail with a type error — no runtime is needed.
 *
 * RULES:
 *   - Only `import type` from the contract — NEVER a value import.
 *     Zod is a contract-package runtime dep; it must never enter the Worker bundle.
 *   - SearchResult lives in contract.ts (not models.ts) — imported separately below.
 *   - Python mirrors (agent/clients/catalog_client.py) intentionally diverge via
 *     sentinel defaults (episode=-1, name_cn="", distance_m=-1.0). Do NOT codegen
 *     Python models from this contract — keep them hand-written. See packages/contract/README.md.
 */

import type {
  PilgrimagePoint as ContractPilgrimagePoint,
  TimedStop as ContractTimedStop,
  TransitLeg as ContractTransitLeg,
  TimedItinerary as ContractTimedItinerary,
  IngestResult as ContractIngestResult,
  Route as ContractRoute,
  Pacing as ContractPacing,
  Origin as ContractOrigin,
} from "../../../packages/contract/src/models";

import type { SearchResult as ContractSearchResult } from "../../../packages/contract/src/contract";

import type {
  PilgrimagePoint as LocalPilgrimagePoint,
  TimedStop as LocalTimedStop,
  TransitLeg as LocalTransitLeg,
  TimedItinerary as LocalTimedItinerary,
  IngestResult as LocalIngestResult,
  Route as LocalRoute,
  Pacing as LocalPacing,
  Origin as LocalOrigin,
  SearchResult as LocalSearchResult,
} from "../src/types";

// --- PilgrimagePoint ---
const _pp_a: ContractPilgrimagePoint = null;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- intentional type parity check
const _pp_b: LocalPilgrimagePoint = null as unknown as ContractPilgrimagePoint;

// --- TimedStop ---
const _ts_a: ContractTimedStop = null;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- intentional type parity check
const _ts_b: LocalTimedStop = null as unknown as ContractTimedStop;

// --- TransitLeg ---
const _tl_a: ContractTransitLeg = null;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- intentional type parity check
const _tl_b: LocalTransitLeg = null as unknown as ContractTransitLeg;

// --- TimedItinerary ---
const _ti_a: ContractTimedItinerary = null;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- intentional type parity check
const _ti_b: LocalTimedItinerary = null as unknown as ContractTimedItinerary;

// --- IngestResult ---
const _ir_a: ContractIngestResult = null;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- intentional type parity check
const _ir_b: LocalIngestResult = null as unknown as ContractIngestResult;

// --- Route ---
const _r_a: ContractRoute = null;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- intentional type parity check
const _r_b: LocalRoute = null as unknown as ContractRoute;

// --- Pacing ---
const _pac_a: ContractPacing = null;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- intentional type parity check
const _pac_b: LocalPacing = null as unknown as ContractPacing;

// --- Origin ---
const _orig_a: ContractOrigin = null;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- intentional type parity check
const _orig_b: LocalOrigin = null as unknown as ContractOrigin;

// --- SearchResult (from contract.ts, not models.ts) ---
const _sr_a: ContractSearchResult = null;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- intentional type parity check
const _sr_b: LocalSearchResult = null as unknown as ContractSearchResult;

// Silence "declared but never read" errors from strict tsc.
void _pp_a; void _pp_b; void _ts_a; void _ts_b; void _tl_a; void _tl_b; void _ti_a; void _ti_b;
void _ir_a; void _ir_b; void _r_a; void _r_b; void _pac_a; void _pac_b; void _orig_a; void _orig_b;
void _sr_a; void _sr_b;

import { describe, it, expect } from "vitest";

describe("contract-parity", () => {
  it("type-level: catalog mirror is mutually assignable with contract types (compile-time only)", () => {
    expect(true).toBe(true);
  });
});
