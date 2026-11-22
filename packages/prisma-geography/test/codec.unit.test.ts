import assert from "node:assert/strict";
import { test } from "node:test";
import { GeographyDescriptor } from "../src/geography/codec.ts";
import { geographyPoint } from "../src/geography/geojson.ts";

const TOKYO_HEX = "0101000020e61000005f984c158c7861408104c58f31d74140";
const TOKYO = geographyPoint(139.7671, 35.6812);
const descriptor = new GeographyDescriptor();
const codec = descriptor.factory({ srid: 4326 })({ name: "GeoPoint.location" });

void test("the codec writes EWKT with the column SRID", async () => {
  assert.equal(await codec.toWire(TOKYO), "SRID=4326;POINT(139.7671 35.6812)");
});

void test("the codec reads the server's EWKB into a structured point", async () => {
  assert.deepEqual(await codec.fromWire(TOKYO_HEX), TOKYO);
});

void test("a stored value is the upper-case EWKB PostGIS prints, and reads back as the point", () => {
  const stored = codec.toDataTypeValue(TOKYO);
  assert.equal(stored.value, TOKYO_HEX.toUpperCase());
  assert.deepEqual(codec.fromDataTypeValue(stored), TOKYO);
});

void test("the codec rejects EWKB with a mismatched SRID", async () => {
  const mismatched = TOKYO_HEX.replace("e6100000", "ad100000");
  await assert.rejects(codec.fromWire(mismatched), /expected SRID 4326/);
});

void test("geographyPoint rejects non-finite coordinates", () => {
  assert.throws(() => geographyPoint(Number.NaN, 35.6812), /finite numbers/);
});
