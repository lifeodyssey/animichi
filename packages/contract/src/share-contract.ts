/**
 * Public itinerary-sharing contract owned by workers/users.
 *
 * Auth: create and revoke require the users-service Neon Auth JWT bearer
 * pattern. Resolve is an anonymous, read-only endpoint for public SSR callers.
 * Expiry/revocation: workers/users chooses an immutable expiry when issuing a
 * token. Resolution after expiry or revocation fails with a typed terminal
 * error; revocation is immediate and a new share must receive a new token.
 * Privacy: resolve returns a strict, purpose-built public projection. It omits
 * full-precision GPS, internal route/share ownership identifiers, and internal
 * user identity IDs because possession of a share URL grants view access only.
 */

import { oc } from "@orpc/contract";
import { z } from "zod";

/** A 256-bit, unpadded Base64URL bearer token (43 URL-safe characters). */
export const ShareToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
/** Inferred share token. */
export type ShareToken = z.infer<typeof ShareToken>;

/** Public lifecycle state of a shared itinerary. */
export const PublicItineraryState = z.enum(["planned", "partial", "completed"]);
/** Inferred public itinerary state. */
export type PublicItineraryState = z.infer<typeof PublicItineraryState>;

const PublicClockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

/** Public anime display metadata; the id is a catalog-facing public id. */
export const PublicSharedAnime = z.strictObject({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
});
/** Inferred public anime display metadata. */
export type PublicSharedAnime = z.infer<typeof PublicSharedAnime>;

/** Public-safe stop data, intentionally excluding GPS coordinates. */
export const PublicSharedStop = z.strictObject({
  point_id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  position: z.number().int().nonnegative(),
  scheduled_time: PublicClockTime.optional(),
  visited_time: PublicClockTime.optional(),
  completed: z.boolean(),
  frame_image_url: z.url().optional(),
  frame_label: z.string().min(1).max(100).optional(),
});
/** Inferred public-safe stop data. */
export type PublicSharedStop = z.infer<typeof PublicSharedStop>;

/** Public comparison artifact already approved for sharing. */
export const PublicSharedComparison = z.strictObject({
  point_id: z.string().min(1).max(128),
  image_url: z.url(),
  caption: z.string().min(1).max(200),
});
/** Inferred public comparison artifact. */
export type PublicSharedComparison = z.infer<typeof PublicSharedComparison>;

/** Attribution displayed with licensed frames and user-created comparisons. */
export const PublicShareAttribution = z.strictObject({
  label: z.string().min(1).max(300),
  url: z.url().optional(),
});
/** Inferred public share attribution. */
export type PublicShareAttribution = z.infer<typeof PublicShareAttribution>;

/** Strict public projection consumed by the anonymous /s/:id page. */
export const PublicSharedItinerary = z.strictObject({
  title: z.string().min(1).max(200),
  anime: PublicSharedAnime,
  state: PublicItineraryState,
  author_display_name: z.string().min(1).max(100).optional(),
  planned_for: z.iso.date().optional(),
  distance_meters: z.number().int().nonnegative().optional(),
  total_stops: z.number().int().nonnegative(),
  completed_stops: z.number().int().nonnegative(),
  stops: z.array(PublicSharedStop).max(500),
  comparisons: z.array(PublicSharedComparison).max(100),
  hero_image_url: z.url().optional(),
  attributions: z.array(PublicShareAttribution).max(20),
});
/** Inferred strict public itinerary projection. */
export type PublicSharedItinerary = z.infer<typeof PublicSharedItinerary>;

/** Authenticated input for sharing a caller-owned route. */
export const CreateShareInput = z.strictObject({ route_id: z.uuid() });
/** Inferred create-share input. */
export type CreateShareInput = z.infer<typeof CreateShareInput>;

/** Newly issued share credentials; expires_at is chosen by workers/users. */
export const CreateShareResult = z.strictObject({
  share_id: z.uuid(),
  token: ShareToken,
  created_at: z.iso.datetime({ offset: true }),
  expires_at: z.iso.datetime({ offset: true }),
});
/** Inferred create-share result. */
export type CreateShareResult = z.infer<typeof CreateShareResult>;

/** Authenticated input for revoking a share without resending its bearer token. */
export const RevokeShareInput = z.strictObject({ share_id: z.uuid() });
/** Inferred revoke-share input. */
export type RevokeShareInput = z.infer<typeof RevokeShareInput>;

/** Confirmation that a share became terminally revoked. */
export const RevokeShareResult = z.strictObject({
  revoked: z.literal(true),
  revoked_at: z.iso.datetime({ offset: true }),
});
/** Inferred revoke-share result. */
export type RevokeShareResult = z.infer<typeof RevokeShareResult>;

/** Anonymous input for resolving a public share token. */
export const ResolveShareInput = z.strictObject({ token: ShareToken });
/** Inferred resolve-share input. */
export type ResolveShareInput = z.infer<typeof ResolveShareInput>;

/** Anonymous public resolution result. */
export const ResolveShareResult = z.strictObject({
  expires_at: z.iso.datetime({ offset: true }),
  itinerary: PublicSharedItinerary,
});
/** Inferred public resolution result. */
export type ResolveShareResult = z.infer<typeof ResolveShareResult>;

/** Share error category semantics; categories never cross the wire. */
export const ShareErrorCategory = z.enum(["user_actionable", "retryable", "system"]);
/** Inferred share error category. */
export type ShareErrorCategory = z.infer<typeof ShareErrorCategory>;

/** Data returned when a route cannot be shared. */
export const ShareRouteData = z.strictObject({ route_id: z.uuid() });
/** Data for a share token that has passed its immutable expiry. */
export const ShareExpiredData = z.strictObject({
  expires_at: z.iso.datetime({ offset: true }),
});
/** Data for a share token that has been explicitly revoked. */
export const ShareRevokedData = z.strictObject({
  revoked_at: z.iso.datetime({ offset: true }),
});
/** Empty public not-found data avoids reflecting bearer tokens. */
export const ShareNotFoundData = z.strictObject({});

type ShareErrorDefItem = {
  readonly status: number;
  readonly category: ShareErrorCategory;
  readonly message: string;
  readonly data: z.ZodType<unknown>;
};

/** Share error registry with registry-only categories omitted from responses. */
export const SHARE_ERROR_DEFS = {
  SHARE_ROUTE_NOT_FOUND: {
    status: 404,
    category: "user_actionable",
    message: "No such saved route",
    data: ShareRouteData,
  },
  SHARE_ROUTE_NOT_OWNED: {
    status: 403,
    category: "user_actionable",
    message: "Route belongs to another user",
    data: ShareRouteData,
  },
  SHARE_NOT_FOUND: {
    status: 404,
    category: "user_actionable",
    message: "No such share",
    data: ShareNotFoundData,
  },
  SHARE_EXPIRED: {
    status: 410,
    category: "user_actionable",
    message: "Share has expired",
    data: ShareExpiredData,
  },
  SHARE_REVOKED: {
    status: 410,
    category: "user_actionable",
    message: "Share has been revoked",
    data: ShareRevokedData,
  },
} as const satisfies Record<string, ShareErrorDefItem>;

/** Share error registry type. */
export type ShareErrorDefs = typeof SHARE_ERROR_DEFS;
/** Share error code union. */
export type ShareErrorCode = keyof ShareErrorDefs;

type ShareErrorMapItem<Code extends ShareErrorCode> = {
  status: ShareErrorDefs[Code]["status"];
  message: ShareErrorDefs[Code]["message"];
  data: ShareErrorDefs[Code]["data"];
};
type ShareErrorMap<Code extends ShareErrorCode> = {
  [Key in Code]: ShareErrorMapItem<Key>;
};

function shareErrorEntry<Code extends ShareErrorCode>(
  code: Code,
): readonly [Code, ShareErrorMapItem<Code>] {
  const { status, message, data } = SHARE_ERROR_DEFS[code];
  return [code, { status, message, data }];
}

/** Pick oRPC error entries while dropping registry-only category metadata. */
export function pickShareErrors<const Code extends ShareErrorCode>(
  codes: readonly Code[],
): ShareErrorMap<Code> {
  return Object.fromEntries(codes.map(shareErrorEntry)) as ShareErrorMap<Code>;
}

/** oRPC contract for authenticated issuance/revocation and anonymous resolution. */
export const shareContract = {
  createShare: oc
    .route({ method: "POST", path: "/v1/users/shares", summary: "Create a route share" })
    .input(CreateShareInput)
    .errors(pickShareErrors(["SHARE_ROUTE_NOT_FOUND", "SHARE_ROUTE_NOT_OWNED"]))
    .output(CreateShareResult),
  revokeShare: oc
    .route({ method: "DELETE", path: "/v1/users/shares/{share_id}", summary: "Revoke a share" })
    .input(RevokeShareInput)
    .errors(pickShareErrors(["SHARE_NOT_FOUND", "SHARE_REVOKED"]))
    .output(RevokeShareResult),
  resolveShare: oc
    .route({ method: "GET", path: "/v1/users/shares/resolve/{token}", summary: "Resolve a public share" })
    .input(ResolveShareInput)
    .errors(pickShareErrors(["SHARE_NOT_FOUND", "SHARE_EXPIRED", "SHARE_REVOKED"]))
    .output(ResolveShareResult),
};

/** Route-sharing oRPC contract type. */
export type ShareContract = typeof shareContract;
