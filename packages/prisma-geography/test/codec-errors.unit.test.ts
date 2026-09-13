import assert from "node:assert/strict";
import { test } from "node:test";
import { GeographyDescriptor } from "../src/geography/codec.ts";
import { geographyPoint } from "../src/geography/geojson.ts";

const TOKYO_HEX = "0101000020e61000005f984c158c7861408104c58f31d74140";
const TOKYO_BIG_ENDIAN_HEX = "0020000001000010e64061788c154c985f4041d7318fc50481";
const descriptor = new GeographyDescriptor();
const dynamicCodec = descriptor.factory({ srid: Number("4326") })({ name: "dynamic" });

void test("the codec accepts big-endian EWKB", async () => {
  assert.deepEqual(await dynamicCodec.decode(TOKYO_BIG_ENDIAN_HEX), geographyPoint(139.7671, 35.6812));
});

void test("the codec rejects malformed wire values", async () => {
  await assert.rejects(dynamicCodec.decode("abcd"), /25-byte hex EWKB/u);
  await assert.rejects(dynamicCodec.decode(`${TOKYO_HEX.slice(0, -1)}g`), /25-byte hex EWKB/u);
  await assert.rejects(dynamicCodec.decode(`2${TOKYO_HEX.slice(1)}`), /invalid byte order/u);
});

void test("the codec rejects unsupported EWKB dimensions and geometry", async () => {
  await assert.rejects(dynamicCodec.decode(withType("010000a0")), /Z\/M coordinates/u);
  await assert.rejects(dynamicCodec.decode(withType("02000020")), /unsupported geometry type 2/u);
  await assert.rejects(dynamicCodec.decode(withType("01000000")), /does not carry an SRID/u);
});

void test("the codec validates JSON and SRID input at runtime", async () => {
  await assert.rejects(dynamicCodec.encode(geographyPoint(139.7671, 35.6812, 4269)), /expected SRID 4326/u);
  assert.throws(() => dynamicCodec.encodeJson(geographyPoint(139.7671, 35.6812, 4269)), /expected SRID 4326/u);
  assert.throws(() => dynamicCodec.decodeJson(42), /must be hex EWKB/u);
});

void test("the descriptor renders SRID-constrained contract types", () => {
  assert.equal(descriptor.nativeTypeFor({ codecId: "pg/geography@1", typeParams: { srid: 4326 } }), "geography");
  assert.equal(descriptor.renderOutputType({ srid: 4326 }), "Geography<4326>");
  assert.equal(descriptor.renderInputType({ srid: 4326 }), "Geography<4326>");
});

void test("geographyPoint rejects an invalid SRID", () => {
  assert.throws(() => geographyPoint(139.7671, 35.6812, -1), /non-negative integer/u);
});

function withType(typeBytes: string): string {
  return `01${typeBytes}${TOKYO_HEX.slice(10)}`;
}
