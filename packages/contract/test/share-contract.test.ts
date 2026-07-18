import { describe, expect, it } from "vitest";
import {
  CreateShareInput,
  CreateShareResult,
  PublicSharedItinerary,
  ResolveShareResult,
  ResolveShareInput,
  RevokeShareResult,
  SHARE_ERROR_DEFS,
  ShareExpiredData,
  ShareToken,
} from "../src/share-contract.js";

const TOKEN = "token-fixture-token-fixture-token-fixture-x";
const ROUTE_ID = "019b984f-1a52-7000-8000-000000000001";

const PUBLIC_ITINERARY = {
  title: "飛騨古川 半日ルート",
  anime: { id: "your-name", title: "君の名は。" },
  state: "completed",
  author_display_name: "ミツハ",
  planned_for: "2026-07-03",
  distance_meters: 2_800,
  total_stops: 2,
  completed_stops: 2,
  stops: [
    {
      point_id: "point-hida-station",
      name: "飛騨古川駅",
      position: 0,
      scheduled_time: "09:30",
      visited_time: "09:31",
      completed: true,
      frame_image_url: "https://images.example/frame.webp",
      frame_label: "第1話 04:12",
    },
  ],
  comparisons: [
    {
      point_id: "point-hida-station",
      image_url: "https://images.example/comparison.webp",
      caption: "飛騨古川駅",
    },
  ],
  attributions: [{ label: "Anitabi (CC BY-NC-SA 4.0)", url: "https://anitabi.cn" }],
} as const;

describe("share token inputs", () => {
  it("accepts a 256-bit unpadded Base64URL token", () => {
    expect(ResolveShareInput.parse({ token: TOKEN })).toEqual({ token: TOKEN });
  });

  it.each(["short", `${TOKEN}=`, `${TOKEN.slice(0, -1)}+`, `${TOKEN}x`])(
    "rejects malformed token %s",
    (token) => {
      expect(ShareToken.safeParse(token).success).toBe(false);
    },
  );

  it("accepts an authenticated create request without client-controlled expiry", () => {
    expect(CreateShareInput.parse({ route_id: ROUTE_ID })).toEqual({ route_id: ROUTE_ID });
  });

  it("accepts issued credentials with server-authored lifecycle timestamps", () => {
    const result = {
      share_id: "019b984f-1a52-7000-8000-000000000002",
      token: TOKEN,
      created_at: "2026-07-19T09:30:00+09:00",
      expires_at: "2026-08-18T09:30:00+09:00",
    };
    expect(CreateShareResult.parse(result)).toEqual(result);
  });

  it("accepts an authenticated revocation confirmation", () => {
    const result = { revoked: true, revoked_at: "2026-07-20T09:30:00+09:00" } as const;
    expect(RevokeShareResult.parse(result)).toEqual(result);
  });
});

describe("share expiry errors", () => {
  it("accepts an expired-share error with an offset timestamp", () => {
    const data = { expires_at: "2026-07-20T09:30:00+09:00" };
    expect(ShareExpiredData.parse(data)).toEqual(data);
    expect(SHARE_ERROR_DEFS.SHARE_EXPIRED.status).toBe(410);
  });

  it("rejects an expired-share error with a malformed timestamp", () => {
    expect(ShareExpiredData.safeParse({ expires_at: "yesterday" }).success).toBe(false);
  });
});

describe("public share projection", () => {
  it("accepts the public itinerary fields needed by the share page", () => {
    expect(PublicSharedItinerary.parse(PUBLIC_ITINERARY)).toEqual(PUBLIC_ITINERARY);
  });

  it("accepts an anonymous resolution envelope without internal identifiers", () => {
    const result = { expires_at: "2026-08-18T09:30:00+09:00", itinerary: PUBLIC_ITINERARY };
    expect(ResolveShareResult.parse(result)).toEqual(result);
  });

  it.each([
    "user_id",
    "internal_user_id",
    "owner_id",
    "created_by",
    "latitude",
    "longitude",
    "coordinates",
  ])(
    "strictly rejects sensitive key %s",
    (sensitiveKey) => {
      const leaked = { ...PUBLIC_ITINERARY, [sensitiveKey]: "sensitive" };
      expect(PublicSharedItinerary.safeParse(leaked).success).toBe(false);
    },
  );

  it("strictly rejects raw GPS nested inside a public stop", () => {
    const stops = [{ ...PUBLIC_ITINERARY.stops[0], latitude: 35.702_123 }];
    expect(PublicSharedItinerary.safeParse({ ...PUBLIC_ITINERARY, stops }).success).toBe(false);
  });
});
