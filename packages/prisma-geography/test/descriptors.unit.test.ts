import assert from "node:assert/strict";
import { ColumnRef } from "@prisma/orm-postgres/relational-core/ast";
import { isPostgresCodecDescriptor } from "@prisma/orm-postgres/target/codec-descriptor";
import { test } from "node:test";
import { geographyCodecRegistry } from "../src/geography/codec.ts";
import { GEOGRAPHY_CODEC_ID } from "../src/geography/constants.ts";
import geographyExtensionDescriptor, { geographyControlPlaneHooks } from "../src/geography/control.ts";
import { geographyPackMeta } from "../src/geography/pack-meta.ts";
import geographyRuntimeDescriptor from "../src/geography/runtime.ts";

void test("the control descriptor authors Geography through the geo namespace", () => {
  const constructor = geographyPackMeta.authoring.type.geo.Geography;
  assert.deepEqual(constructor, {
    kind: "typeConstructor",
    args: [{ kind: "number", name: "srid", integer: true, minimum: 0 }],
    output: {
      codecId: "pg/geography@1",
      nativeType: "geography",
      typeParams: { srid: { kind: "arg", index: 0 } },
    },
  });
});

void test("the control hook expands the authored native type", () => {
  const expanded = geographyControlPlaneHooks.expandNativeType({ nativeType: "geography", typeParams: { srid: 4326 } });
  assert.equal(expanded, "geography(Point,4326)");
});

void test("control and runtime descriptors are distinct exports", () => {
  assert.notEqual(geographyExtensionDescriptor, geographyRuntimeDescriptor);
  assert.equal(geographyExtensionDescriptor.id, geographyRuntimeDescriptor.id);
});

void test("the runtime codec's JSON projection passes the column expression through", () => {
  const registered = geographyCodecRegistry.descriptorFor(GEOGRAPHY_CODEC_ID);
  assert.ok(isPostgresCodecDescriptor(registered));
  const location = ColumnRef.of("geo_points", "location");
  const projected = registered.projectJson(location, { codecId: GEOGRAPHY_CODEC_ID, typeParams: { srid: 4326 } });
  assert.equal(projected, location);
});
