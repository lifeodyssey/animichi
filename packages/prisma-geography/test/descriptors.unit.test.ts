import assert from "node:assert/strict";
import {
  renderSqlCatalogText,
  renderSqlTypeName,
  resolveReportedSqlType,
  resolveWrittenSqlTypes,
} from "@prisma/orm-postgres/family-contract/data-type";
import { dataTypeParams } from "@prisma/orm-postgres/components/codec";
import { CastExpr, ColumnRef } from "@prisma/orm-postgres/relational-core/ast";
import { isPostgresCodecDescriptor } from "@prisma/orm-postgres/target/codec-descriptor";
import { test } from "node:test";
import { geographyCodecRegistry } from "../src/geography/codec.ts";
import { GEOGRAPHY_CODEC_ID } from "../src/geography/constants.ts";
import geographyExtensionDescriptor from "../src/geography/control.ts";
import { geoGeography } from "../src/geography/data-type.ts";
import { geographyPackMeta } from "../src/geography/pack-meta.ts";
import geographyRuntimeDescriptor from "../src/geography/runtime.ts";

const COLUMN_TYPE = "geography(Point,4326)";

void test("the control descriptor authors Geography through the geo namespace", () => {
  assert.deepEqual(geographyPackMeta.authoring.type.geo.Geography, {
    kind: "typeConstructor",
    inferred: true,
    args: [{ kind: "value", dataType: "pg/int4", name: "srid" }],
    output: { codecId: "pg/geography@1", typeParams: { srid: { kind: "arg", index: 0 } } },
  });
});

// The planner writes a column's type from the parameters its data type declares (`dataTypeParams`),
// so the column's `srid` stays the codec's and the type writes its one text.
void test("the data type writes geography(Point,4326), the column's srid being the codec's", () => {
  assert.deepEqual(dataTypeParams(geoGeography, { srid: 4326 }), {});
  assert.equal(renderSqlTypeName(geoGeography, dataTypeParams(geoGeography, { srid: 4326 })), COLUMN_TYPE);
});

void test("a migration's geography(Point,4326) reads as the pack's data type", () => {
  const [resolved, ...others] = resolveWrittenSqlTypes(COLUMN_TYPE, [geoGeography]);
  assert.equal(resolved?.dataType.id, "geo/geography");
  assert.deepEqual(others, []);
});

void test("the catalog's text for the column reads back as the pack's data type", () => {
  assert.equal(renderSqlCatalogText(geoGeography, {}), COLUMN_TYPE);
  const reported = { text: COLUMN_TYPE, kind: undefined, schema: "public", name: "geography" };
  assert.equal(resolveReportedSqlType(reported, [geoGeography])?.dataType.id, "geo/geography");
});

void test("a geography of another SRID is no column of the pack's data type", () => {
  assert.deepEqual(resolveWrittenSqlTypes("geography(Point,3857)", [geoGeography]), []);
});

void test("control and runtime descriptors are distinct exports registering the same data type", () => {
  assert.notEqual(geographyExtensionDescriptor, geographyRuntimeDescriptor);
  assert.equal(geographyExtensionDescriptor.id, geographyRuntimeDescriptor.id);
  assert.deepEqual(geographyPackMeta.dataTypes, [geoGeography]);
  assert.deepEqual(geographyRuntimeDescriptor.dataTypes, [geoGeography]);
});

void test("the runtime codec's JSON projection reads the column as the text a row carries", () => {
  const registered = geographyCodecRegistry.descriptorFor(GEOGRAPHY_CODEC_ID);
  assert.ok(isPostgresCodecDescriptor(registered));
  const location = ColumnRef.of("geo_points", "location");
  const projected = registered.projectJson(location, { codecId: GEOGRAPHY_CODEC_ID, typeParams: { srid: 4326 } });
  assert.deepEqual(projected, CastExpr.as(location, "text"));
});
