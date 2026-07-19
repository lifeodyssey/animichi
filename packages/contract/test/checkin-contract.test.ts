import { describe, expect, it } from "vitest";
import {
  GpsCoordinates,
  SubmitCheckinInput,
  TraceGpsCoordinates,
  TruncatedGpsCoordinates,
} from "../src/checkin-contract.js";

const VALID_INPUT = {
  route_id: "019b984f-1a52-7000-8000-000000000001",
  point_id: "point-kanda-myojin",
  client_id: "019b984f-1a52-7000-8000-000000000002",
  coordinates: { latitude: 35.702_123_4, longitude: 139.767_654_3 },
  checked_in_at: "2026-07-19T09:30:00+09:00",
  photo_ref: "walk-checkins/photo-01.webp",
} as const;

describe("SubmitCheckinInput", () => {
  it("accepts a full-precision check-in with an optional photo reference", () => {
    expect(SubmitCheckinInput.parse(VALID_INPUT)).toEqual(VALID_INPUT);
  });

  it.each([
    { latitude: 90.000_1, longitude: 139.7 },
    { latitude: 35.7, longitude: -180.000_1 },
  ])("rejects out-of-range GPS coordinates", (coordinates) => {
    expect(SubmitCheckinInput.safeParse({ ...VALID_INPUT, coordinates }).success).toBe(false);
  });

  it("rejects a missing idempotency key", () => {
    const { client_id: _clientId, ...withoutClientId } = VALID_INPUT;
    expect(SubmitCheckinInput.safeParse(withoutClientId).success).toBe(false);
  });

  it.each(["offline-queue-1", "019b984f-1a52-7000-8000"])(
    "rejects malformed idempotency key %s",
    (client_id) => {
      expect(SubmitCheckinInput.safeParse({ ...VALID_INPUT, client_id }).success).toBe(false);
    },
  );
});

describe("GPS privacy schemas", () => {
  it("retains full precision for API and storage coordinates", () => {
    expect(GpsCoordinates.parse(VALID_INPUT.coordinates)).toEqual(VALID_INPUT.coordinates);
  });

  it("rejects trace coordinates exceeding 3 decimal places", () => {
    expect(TruncatedGpsCoordinates.safeParse(VALID_INPUT.coordinates).success).toBe(false);
  });

  it("truncates positive and negative coordinates toward zero to 3 decimal places", () => {
    const precise = { latitude: -35.702_987, longitude: 139.767_987 };
    expect(TraceGpsCoordinates.parse(precise)).toEqual({ latitude: -35.702, longitude: 139.767 });
  });
});
