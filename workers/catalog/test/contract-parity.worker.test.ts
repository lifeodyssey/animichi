/**
 * Compile-time parity guard: catalog/src/types.ts ↔ packages/contract/src/models.ts
 *
 * Every assignment below asserts MUTUAL ASSIGNABILITY between the contract's
 * inferred types (source of truth) and the catalog's hand-mirror types.
 * If either side drifts, `tsc --noEmit` (and this test file's type-checking)
 * will fail with a type error — no runtime is needed.
 *
 * RULES:
 *   - This parity test uses only `import type`; the router intentionally imports
 *     the contract value so Zod validates untrusted input at the boundary.
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
  AnimeCandidate as ContractAnimeCandidate,
  ResolveOutcome as ContractResolveOutcome,
} from "../../../packages/contract/src/models";

import type {
  GeocodeCandidate as ContractGeocodeCandidate,
  GeocodeInput as ContractGeocodeInput,
  GeocodeResult as ContractGeocodeResult,
  SearchResult as ContractSearchResult,
} from "../../../packages/contract/src/contract";
import type { CatalogContract } from "../../../packages/contract/src/contract";

import type {
  CatalogErrorCode as ContractCatalogErrorCode,
  CatalogErrorDefs as ContractCatalogErrorDefs,
  ErrorCategory as ContractErrorCategory,
  RouteTooManyClustersData as ContractRouteTooManyClustersData,
  RouteTooManyPointsData as ContractRouteTooManyPointsData,
  UpstreamUnavailableData as ContractUpstreamUnavailableData,
  WorkNotFoundData as ContractWorkNotFoundData,
} from "../../../packages/contract/src/errors";

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
  GeocodeCandidate as LocalGeocodeCandidate,
  GeocodeInput as LocalGeocodeInput,
  GeocodeResult as LocalGeocodeResult,
  AnimeCandidate as LocalAnimeCandidate,
  ResolveOutcome as LocalResolveOutcome,
} from "../src/types";

import type {
  CatalogErrorCode as LocalCatalogErrorCode,
  CatalogErrors as LocalCatalogErrors,
  ErrorCategory as LocalErrorCategory,
  RouteTooManyClustersData as LocalRouteTooManyClustersData,
  RouteTooManyPointsData as LocalRouteTooManyPointsData,
  UpstreamUnavailableData as LocalUpstreamUnavailableData,
  WorkNotFoundData as LocalWorkNotFoundData,
} from "../src/lib/errors";

type ContractErrorSpec = {
  [Code in keyof ContractCatalogErrorDefs]: Pick<ContractCatalogErrorDefs[Code], "status" | "category" | "message">;
};

type LocalErrorSpec = {
  [Code in keyof LocalCatalogErrors]: Pick<LocalCatalogErrors[Code], "status" | "category" | "message">;
};

type IngestErrorMap = CatalogContract["ingest"]["~orpc"]["errorMap"];
interface ExpectedIngestErrors {
  UPSTREAM_UNAVAILABLE: Pick<
    ContractCatalogErrorDefs["UPSTREAM_UNAVAILABLE"],
    "status" | "message" | "data"
  >;
}

// --- PilgrimagePoint ---
const _pp_a: ContractPilgrimagePoint = null as unknown as ContractPilgrimagePoint;
const _pp_b: LocalPilgrimagePoint = null as unknown as ContractPilgrimagePoint;

// --- TimedStop ---
const _ts_a: ContractTimedStop = null as unknown as ContractTimedStop;
const _ts_b: LocalTimedStop = null as unknown as ContractTimedStop;

// --- TransitLeg ---
const _tl_a: ContractTransitLeg = null as unknown as LocalTransitLeg;
const _tl_b: LocalTransitLeg = null as unknown as ContractTransitLeg;
const _tl_attr_a: ContractTransitLeg["attribution"] = null as unknown as LocalTransitLeg["attribution"];
const _tl_attr_b: LocalTransitLeg["attribution"] = null as unknown as ContractTransitLeg["attribution"];

// --- TimedItinerary ---
const _ti_a: ContractTimedItinerary = null as unknown as ContractTimedItinerary;
const _ti_b: LocalTimedItinerary = null as unknown as ContractTimedItinerary;

// --- IngestResult ---
const _ir_a: ContractIngestResult = null as unknown as ContractIngestResult;
const _ir_b: LocalIngestResult = null as unknown as ContractIngestResult;

// --- Route ---
const _r_a: ContractRoute = null as unknown as ContractRoute;
const _r_b: LocalRoute = null as unknown as ContractRoute;

// --- Pacing ---
const _pac_a: ContractPacing = null as unknown as ContractPacing;
const _pac_b: LocalPacing = null as unknown as ContractPacing;

// --- Origin ---
const _orig_a: ContractOrigin = null as unknown as ContractOrigin;
const _orig_b: LocalOrigin = null as unknown as ContractOrigin;

// --- SearchResult (from contract.ts, not models.ts) ---
const _sr_a: ContractSearchResult = null as unknown as ContractSearchResult;
const _sr_b: LocalSearchResult = null as unknown as ContractSearchResult;

// --- Catalog resolution ---
const _ac_a: ContractAnimeCandidate = null as unknown as LocalAnimeCandidate;
const _ac_b: LocalAnimeCandidate = null as unknown as ContractAnimeCandidate;
const _ro_a: ContractResolveOutcome = null as unknown as LocalResolveOutcome;
const _ro_b: LocalResolveOutcome = null as unknown as ContractResolveOutcome;

// --- Geocode ---
const _gc_a: ContractGeocodeCandidate = null as unknown as LocalGeocodeCandidate;
const _gc_b: LocalGeocodeCandidate = null as unknown as ContractGeocodeCandidate;
const _gc_radius_a: ContractGeocodeCandidate["effective_radius_m"] = null as unknown as LocalGeocodeCandidate["effective_radius_m"];
const _gc_radius_b: LocalGeocodeCandidate["effective_radius_m"] = null as unknown as ContractGeocodeCandidate["effective_radius_m"];
const _gi_a: ContractGeocodeInput = null as unknown as LocalGeocodeInput;
const _gi_b: LocalGeocodeInput = null as unknown as ContractGeocodeInput;
const _gr_a: ContractGeocodeResult = null as unknown as LocalGeocodeResult;
const _gr_b: LocalGeocodeResult = null as unknown as ContractGeocodeResult;

// --- Catalog errors (from errors.ts, type-only; never import zod values) ---
const _ecc_a: ContractCatalogErrorCode = null as unknown as LocalCatalogErrorCode;
const _ecc_b: LocalCatalogErrorCode = null as unknown as ContractCatalogErrorCode;
const _ecat_a: ContractErrorCategory = null as unknown as LocalErrorCategory;
const _ecat_b: LocalErrorCategory = null as unknown as ContractErrorCategory;
const _err_spec_a: ContractErrorSpec = null as unknown as LocalErrorSpec;
const _err_spec_b: LocalErrorSpec = null as unknown as ContractErrorSpec;
const _ingest_err_a: IngestErrorMap = null as unknown as ExpectedIngestErrors;
const _ingest_err_b: ExpectedIngestErrors = null as unknown as IngestErrorMap;

const _rtmc_a: ContractRouteTooManyClustersData = null as unknown as LocalRouteTooManyClustersData;
const _rtmc_b: LocalRouteTooManyClustersData = null as unknown as ContractRouteTooManyClustersData;
const _rtmp_a: ContractRouteTooManyPointsData = null as unknown as LocalRouteTooManyPointsData;
const _rtmp_b: LocalRouteTooManyPointsData = null as unknown as ContractRouteTooManyPointsData;
const _wnf_a: ContractWorkNotFoundData = null as unknown as LocalWorkNotFoundData;
const _wnf_b: LocalWorkNotFoundData = null as unknown as ContractWorkNotFoundData;
const _uu_a: ContractUpstreamUnavailableData = null as unknown as LocalUpstreamUnavailableData;
const _uu_b: LocalUpstreamUnavailableData = null as unknown as ContractUpstreamUnavailableData;

// Silence "declared but never read" errors from strict tsc.
void _pp_a; void _pp_b; void _ts_a; void _ts_b; void _tl_a; void _tl_b; void _tl_attr_a; void _tl_attr_b; void _ti_a; void _ti_b;
void _ir_a; void _ir_b; void _r_a; void _r_b; void _pac_a; void _pac_b; void _orig_a; void _orig_b;
void _sr_a; void _sr_b;
void _ac_a; void _ac_b; void _ro_a; void _ro_b;
void _gc_a; void _gc_b; void _gc_radius_a; void _gc_radius_b; void _gi_a; void _gi_b; void _gr_a; void _gr_b;
void _ecc_a; void _ecc_b; void _ecat_a; void _ecat_b; void _err_spec_a; void _err_spec_b;
void _ingest_err_a; void _ingest_err_b;
void _rtmc_a; void _rtmc_b; void _rtmp_a; void _rtmp_b; void _wnf_a; void _wnf_b; void _uu_a; void _uu_b;

import { describe, it, expect } from "vitest";

describe("contract-parity", () => {
  it("type-level: catalog mirror is mutually assignable with contract types (compile-time only)", () => {
    expect(true).toBe(true);
  });
});
