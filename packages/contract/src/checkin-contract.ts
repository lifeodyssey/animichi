/**
 * Walk check-in contract owned by workers/users.
 *
 * Auth: every procedure requires the users-service Neon Auth JWT bearer pattern;
 * anonymous reads and writes are forbidden.
 * Replay: client_id is the offline idempotency key. Reusing it with the same
 * payload returns the original stored result, never a new record; a changed
 * payload is an idempotency conflict.
 * Privacy: API and storage coordinates retain full precision. Before coordinates
 * enter observability, project them through TraceGpsCoordinates, which truncates
 * toward zero to 3 decimal places (roughly 100 m) per iter-3 S3.3/S3.7.
 * photo_ref is an opaque reference only; upload/presign belongs to card #249.
 */

import { oc } from "@orpc/contract";
import { z } from "zod";

/** Full-precision GPS coordinates retained by the API and storage layer. */
export const GpsCoordinates = z.strictObject({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
/** Full-precision GPS coordinates. */
export type GpsCoordinates = z.infer<typeof GpsCoordinates>;

function truncateCoordinate(value: number): number {
  return Math.trunc(value * 1_000) / 1_000;
}

function hasTracePrecision(value: number): boolean {
  return value === truncateCoordinate(value);
}

/** GPS coordinates already safe for observability (at most 3 decimal places). */
export const TruncatedGpsCoordinates = z.strictObject({
  latitude: z.number().min(-90).max(90).refine(hasTracePrecision),
  longitude: z.number().min(-180).max(180).refine(hasTracePrecision),
});
/** GPS coordinates safe for observability. */
export type TruncatedGpsCoordinates = z.infer<typeof TruncatedGpsCoordinates>;

/** Project full-precision GPS coordinates to the trace-safe representation. */
export const TraceGpsCoordinates = GpsCoordinates.transform(({ latitude, longitude }) => ({
  latitude: truncateCoordinate(latitude),
  longitude: truncateCoordinate(longitude),
})).pipe(TruncatedGpsCoordinates);

/** Walk check-in returned by workers/users. */
export const WalkCheckin = z.strictObject({
  id: z.uuid(),
  route_id: z.uuid(),
  point_id: z.string().min(1).max(128),
  client_id: z.uuid(),
  coordinates: GpsCoordinates,
  checked_in_at: z.iso.datetime({ offset: true }),
  synced_at: z.iso.datetime({ offset: true }),
  photo_ref: z.string().min(1).max(512).optional(),
});
/** Walk check-in returned by workers/users. */
export type WalkCheckin = z.infer<typeof WalkCheckin>;

/** Offline-replay-safe input for submitting a walk check-in. */
export const SubmitCheckinInput = z.strictObject({
  route_id: z.uuid(),
  point_id: z.string().min(1).max(128),
  client_id: z.uuid(),
  coordinates: GpsCoordinates,
  checked_in_at: z.iso.datetime({ offset: true }),
  photo_ref: z.string().min(1).max(512).optional(),
});
/** Offline-replay-safe input for submitting a walk check-in. */
export type SubmitCheckinInput = z.infer<typeof SubmitCheckinInput>;

/** Optional route filter when listing the authenticated user's check-ins. */
export const ListCheckinsInput = z.strictObject({ route_id: z.uuid().optional() });
/** Optional route filter for listing check-ins. */
export type ListCheckinsInput = z.infer<typeof ListCheckinsInput>;

/** Check-ins owned by the authenticated user; an empty result is an empty array. */
export const ListCheckinsResult = z.strictObject({ checkins: z.array(WalkCheckin) });
/** Result of listing the authenticated user's check-ins. */
export type ListCheckinsResult = z.infer<typeof ListCheckinsResult>;

/** Check-in error category semantics; categories never cross the wire. */
export const CheckinErrorCategory = z.enum(["user_actionable", "retryable", "system"]);
/** Inferred check-in error category. */
export type CheckinErrorCategory = z.infer<typeof CheckinErrorCategory>;

/** Data returned when an idempotency key is replayed with changed input. */
export const CheckinReplayConflictData = z.strictObject({ client_id: z.uuid() });
/** Inferred replay-conflict data. */
export type CheckinReplayConflictData = z.infer<typeof CheckinReplayConflictData>;

/** Data returned when a route is unavailable to the authenticated user. */
export const CheckinRouteNotFoundData = z.strictObject({ route_id: z.uuid() });
/** Inferred route-not-found data. */
export type CheckinRouteNotFoundData = z.infer<typeof CheckinRouteNotFoundData>;

/** Data returned when a pilgrimage point does not exist. */
export const CheckinPointNotFoundData = z.strictObject({ point_id: z.string() });
/** Inferred point-not-found data. */
export type CheckinPointNotFoundData = z.infer<typeof CheckinPointNotFoundData>;

type CheckinErrorDefItem = {
  readonly status: number;
  readonly category: CheckinErrorCategory;
  readonly message: string;
  readonly data: z.ZodType<unknown>;
};

/** Check-in error registry with registry-only categories omitted from responses. */
export const CHECKIN_ERROR_DEFS = {
  CHECKIN_REPLAY_CONFLICT: {
    status: 409,
    category: "user_actionable",
    message: "Idempotency key was already used with a different payload",
    data: CheckinReplayConflictData,
  },
  CHECKIN_ROUTE_NOT_FOUND: {
    status: 404,
    category: "user_actionable",
    message: "No such user route",
    data: CheckinRouteNotFoundData,
  },
  CHECKIN_POINT_NOT_FOUND: {
    status: 404,
    category: "user_actionable",
    message: "No such pilgrimage point",
    data: CheckinPointNotFoundData,
  },
} as const satisfies Record<string, CheckinErrorDefItem>;

/** Check-in error registry type. */
export type CheckinErrorDefs = typeof CHECKIN_ERROR_DEFS;
/** Check-in error code union. */
export type CheckinErrorCode = keyof CheckinErrorDefs;

type CheckinErrorMapItem<Code extends CheckinErrorCode> = {
  status: CheckinErrorDefs[Code]["status"];
  message: CheckinErrorDefs[Code]["message"];
  data: CheckinErrorDefs[Code]["data"];
};
type CheckinErrorMap<Code extends CheckinErrorCode> = {
  [Key in Code]: CheckinErrorMapItem<Key>;
};

function checkinErrorEntry<Code extends CheckinErrorCode>(
  code: Code,
): readonly [Code, CheckinErrorMapItem<Code>] {
  const { status, message, data } = CHECKIN_ERROR_DEFS[code];
  return [code, { status, message, data }];
}

/** Pick oRPC error entries while dropping registry-only category metadata. */
export function pickCheckinErrors<const Code extends CheckinErrorCode>(
  codes: readonly Code[],
): CheckinErrorMap<Code> {
  return Object.fromEntries(codes.map(checkinErrorEntry)) as CheckinErrorMap<Code>;
}

/** oRPC contract for authenticated walk check-in operations. */
export const checkinContract = {
  submitCheckin: oc
    .route({ method: "POST", path: "/v1/users/checkins", summary: "Submit a walk check-in" })
    .input(SubmitCheckinInput)
    .errors(pickCheckinErrors([
      "CHECKIN_REPLAY_CONFLICT",
      "CHECKIN_ROUTE_NOT_FOUND",
      "CHECKIN_POINT_NOT_FOUND",
    ]))
    .output(WalkCheckin),
  listCheckins: oc
    .route({ method: "GET", path: "/v1/users/checkins", summary: "List the caller's check-ins" })
    .input(ListCheckinsInput)
    .output(ListCheckinsResult),
};

/** Walk check-in oRPC contract type. */
export type CheckinContract = typeof checkinContract;
