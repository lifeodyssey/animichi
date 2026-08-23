import { describe, expect, it } from "vitest";

import integrationConfig from "../../vitest.integration.config";

describe("integration test isolation", () => {
  it("builds shared output once before test workers start", () => {
    expect(integrationConfig.test?.globalSetup).toEqual(["tests/setup/build-integration-output.ts"]);
  });
});
