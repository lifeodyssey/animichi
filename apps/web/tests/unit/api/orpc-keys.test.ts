import { describe, expect, it } from "vitest";
import { createCatalogClient, createUsersClient } from "../../../src/api/clients";
import { createCatalogUtils, createUsersUtils } from "../../../src/api/orpc";

const catalogUtils = createCatalogUtils(createCatalogClient({ url: "https://catalog.test" }));
const usersUtils = createUsersUtils(createUsersClient({ url: "https://users.test" }));

describe("oRPC tanstack utils key prefixes", () => {
  it("prefixes catalog queries under the catalog namespace", () => {
    const [path] = catalogUtils.search.key();
    expect(path).toEqual(["catalog", "search"]);
  });

  it("prefixes users queries under the users namespace", () => {
    const [path] = usersUtils.listRoutes.key();
    expect(path).toEqual(["users", "listRoutes"]);
  });

  it("keeps the two service namespaces disjoint", () => {
    const [catalogPath] = catalogUtils.search.key();
    const [usersPath] = usersUtils.listRoutes.key();
    expect(catalogPath[0]).toBe("catalog");
    expect(usersPath[0]).toBe("users");
  });
});
