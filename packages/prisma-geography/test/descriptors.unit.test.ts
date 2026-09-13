import assert from "node:assert/strict";
import { test } from "node:test";
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
