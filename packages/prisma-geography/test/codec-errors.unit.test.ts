import assert from "node:assert/strict";
import { test } from "node:test";
import { GeographyDescriptor } from "../src/geography/codec.ts";
import { geoGeography } from "../src/geography/data-type.ts";
import { geographyPoint, type GeographyPoint } from "../src/geography/geojson.ts";

const TOKYO_HEX = "0101000020e61000005f984c158c7861408104c58f31d74140";
const TOKYO_BIG_ENDIAN_HEX = "0020000001000010e64061788c154c985f4041d7318fc50481";
const descriptor = new GeographyDescriptor();
const codec = descriptor.factory({ srid: 4326 })({ name: "GeoPoint.location" });

void test("the codec accepts big-endian EWKB", async () => {
  assert.deepEqual(await codec.fromWire(TOKYO_BIG_ENDIAN_HEX), geographyPoint(139.7671, 35.6812));
});

void test("the codec rejects malformed wire values", async () => {
  await assert.rejects(codec.fromWire("abcd"), /25-byte hex EWKB/u);
  await assert.rejects(codec.fromWire(`${TOKYO_HEX.slice(0, -1)}g`), /25-byte hex EWKB/u);
  await assert.rejects(codec.fromWire(`2${TOKYO_HEX.slice(1)}`), /invalid byte order/u);
});

void test("the codec rejects unsupported EWKB dimensions and geometry", async () => {
  await assert.rejects(codec.fromWire(withType("010000a0")), /Z\/M coordinates/u);
  await assert.rejects(codec.fromWire(withType("02000020")), /unsupported geometry type 2/u);
  await assert.rejects(codec.fromWire(withType("01000000")), /does not carry an SRID/u);
});

void test("the codec validates the SRID of a point it writes", async () => {
  await assert.rejects(codec.toWire(asPoint(geographyPoint(139.7671, 35.6812, 4269))), /expected SRID 4326/u);
  assert.throws(() => codec.toDataTypeValue(asPoint(geographyPoint(139.7671, 35.6812, 4269))), /expected SRID 4326/u);
});

void test("the data type refuses a stored value that is not a hex EWKB point in SRID 4326", () => {
  assert.throws(() => geoGeography.valueFrom(42, {}), /geo\/geography/u);
  assert.throws(() => geoGeography.valueFrom(TOKYO_HEX.replace("e6100000", "ad100000"), {}), /geo\/geography/u);
});

void test("the codec validates the complete point shape before encoding", async () => {
  const invalid = asPoint({ type: "LineString", coordinates: [139.7671, 35.6812], srid: 4326 });
  await assert.rejects(codec.toWire(invalid), { name: "ZodError" });
  assert.throws(() => codec.toDataTypeValue(invalid), { name: "ZodError" });
});

void test("the codec rejects point coordinates with the wrong shape", () => {
  const invalid = asPoint({ type: "Point", coordinates: [139.7671, 35.6812, 0], srid: 4326 });
  assert.throws(() => codec.toDataTypeValue(invalid), { name: "ZodError" });
});

void test("the codec rejects non-finite coordinates supplied at runtime", () => {
  const invalid = asPoint({ type: "Point", coordinates: [Number.NaN, 35.6812], srid: 4326 });
  assert.throws(() => codec.toDataTypeValue(invalid), { name: "ZodError" });
});

void test("the codec rejects non-integer SRIDs supplied at runtime", () => {
  const invalid = asPoint({ type: "Point", coordinates: [139.7671, 35.6812], srid: 4326.5 });
  assert.throws(() => codec.toDataTypeValue(invalid), { name: "ZodError" });
});

void test("the codec rejects a point with extra fields", () => {
  const invalid = asPoint({ type: "Point", coordinates: [139.7671, 35.6812], srid: 4326, altitude: 10 });
  assert.throws(() => codec.toDataTypeValue(invalid), { name: "ZodError" });
});

void test("the descriptor names its data type and admits only SRID 4326", async () => {
  assert.equal(descriptor.dataType, "geo/geography");
  assert.equal((await descriptor.paramsSchema["~standard"].validate({ srid: 4326 })).issues, undefined);
  const refused = await descriptor.paramsSchema["~standard"].validate({ srid: 3857 });
  assert.match(refused.issues?.[0]?.message ?? "", /only SRID 4326/u);
  assert.throws(() => descriptor.factory({ srid: 3857 }), /only SRID 4326/u);
});

void test("geographyPoint rejects an invalid SRID", () => {
  assert.throws(() => geographyPoint(139.7671, 35.6812, -1), /non-negative integer/u);
});

function withType(typeBytes: string): string {
  return `01${typeBytes}${TOKYO_HEX.slice(10)}`;
}

function asPoint(value: unknown): GeographyPoint<4326> {
  return value as GeographyPoint<4326>;
}
