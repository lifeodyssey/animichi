import { geographyPoint, type GeographyPoint } from "./geojson.ts";

const FLAG_Z = 0x80000000;
const FLAG_M = 0x40000000;
const FLAG_SRID = 0x20000000;
const TYPE_MASK = 0x1fffffff;
const TYPE_POINT = 1;

export function decodePointEwkbHex<const Srid extends number>(hex: string, expectedSrid: Srid): GeographyPoint<Srid> {
  const view = new DataView(bytesOf(hex).buffer);
  const littleEndian = byteOrderOf(view);
  const typeCode = view.getUint32(1, littleEndian) >>> 0;
  assertSupportedPoint(typeCode);
  const srid = readSrid(view, typeCode, littleEndian);
  assertExpectedSrid(srid, expectedSrid);
  const offset = 9;
  return geographyPoint(view.getFloat64(offset, littleEndian), view.getFloat64(offset + 8, littleEndian), expectedSrid);
}

export function encodePointEwkt(value: GeographyPoint): string {
  const [longitude, latitude] = value.coordinates;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new TypeError("geography encode: coordinates must be finite numbers");
  }
  return `SRID=${String(value.srid)};POINT(${String(longitude)} ${String(latitude)})`;
}

function bytesOf(hex: string): Uint8Array {
  if (hex.length !== 50 || !/^[0-9a-f]+$/iu.test(hex)) {
    throw new TypeError("geography decode: expected 25-byte hex EWKB Point with SRID");
  }
  return Uint8Array.from(hex.match(/../gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

function byteOrderOf(view: DataView): boolean {
  const byteOrder = view.getUint8(0);
  if (byteOrder !== 0 && byteOrder !== 1) {
    throw new TypeError(`geography decode: invalid byte order ${String(byteOrder)}`);
  }
  return byteOrder === 1;
}

function assertSupportedPoint(typeCode: number): void {
  if ((typeCode & (FLAG_Z | FLAG_M)) !== 0) {
    throw new TypeError("geography decode: Z/M coordinates are not supported");
  }
  if ((typeCode & TYPE_MASK) !== TYPE_POINT) {
    throw new TypeError(`geography decode: unsupported geometry type ${String(typeCode & TYPE_MASK)}`);
  }
}

function readSrid(view: DataView, typeCode: number, littleEndian: boolean): number {
  if ((typeCode & FLAG_SRID) === 0) {
    throw new TypeError("geography decode: EWKB Point does not carry an SRID");
  }
  return view.getUint32(5, littleEndian) >>> 0;
}

function assertExpectedSrid<const Srid extends number>(actual: number, expected: Srid): asserts actual is Srid {
  if (actual !== expected) {
    throw new TypeError(`geography decode: expected SRID ${String(expected)}, received ${String(actual)}`);
  }
}
