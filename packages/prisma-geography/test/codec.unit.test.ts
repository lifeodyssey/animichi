import assert from "node:assert/strict";
import { test } from "node:test";
import { GeographyDescriptor } from "../src/geography/codec.ts";
import { geographyPoint } from "../src/geography/geojson.ts";

const TOKYO_HEX = "0101000020e61000005f984c158c7861408104c58f31d74140";
const descriptor = new GeographyDescriptor();
const codec = descriptor.factory({ srid: 4326 })({ name: "GeoPoint.location" });

void test("the codec writes EWKT with the column SRID", async () => {
  const encoded = await codec.encode(geographyPoint(139.7671, 35.6812));
  assert.equal(encoded, "SRID=4326;POINT(139.7671 35.6812)");
});

void test("the codec decodes EWKB into a structured point", async () => {
  const decoded = await codec.decode(TOKYO_HEX);
  assert.deepEqual(decoded, geographyPoint(139.7671, 35.6812));
});

void test("the JSON codec uses the same stable representations", () => {
  assert.equal(codec.encodeJson(geographyPoint(139.7671, 35.6812)), "SRID=4326;POINT(139.7671 35.6812)");
  assert.deepEqual(codec.decodeJson(TOKYO_HEX), geographyPoint(139.7671, 35.6812));
});

void test("the codec rejects EWKB with a mismatched SRID", async () => {
  const mismatched = TOKYO_HEX.replace("e6100000", "ad100000");
  await assert.rejects(codec.decode(mismatched), /expected SRID 4326/);
});

void test("geographyPoint rejects non-finite coordinates", () => {
  assert.throws(() => geographyPoint(Number.NaN, 35.6812), /finite numbers/);
});
