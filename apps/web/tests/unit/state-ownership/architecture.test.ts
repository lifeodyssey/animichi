/**
 * State-ownership architecture gate for `apps/web/src` (issue #1009).
 *
 * AC1 — import boundaries: route/component → feature → API/platform, never
 *       reverse; cross-feature deep runtime imports rejected (the #842
 *       map-primitive edges and the shared `features/auth/ui` login-wall
 *       boundary are the only exempt edges). No feature→UI reverse-edge
 *       allowlist exists — the turnstile gate stays chat-owned.
 * AC2 — UI never calls transport clients; browser storage only inside the
 *       named feature-owned adapter allowlist.
 * AC3 — SSR request caches are isolated, hydration does not double-fetch, and
 *       URL-owned state has no second local authority.
 * AC4 — query results are never copied into local state (derived values are
 *       computed, not synchronized).
 * AC6 — the reviewer fixture's single fact is detected on all four ownership
 *       channels (URL, Query cache, Context, local state).
 *
 * Every rule runs over the whole `src/` tree, so a new violation fails the
 * gate here before review — the machine-enforced replacement for the
 * peer-review-only back-edge rule that `apps/web/AGENTS.md` used to describe.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAP_PRIMITIVE_EDGES,
  SHARED_UI_FEATURE,
  STORAGE_ADAPTERS,
  dependencyViolations,
  duplicateFactViolations,
  localCopyViolations,
  storageViolations,
  transportViolations,
} from "./checker";
import {
  channelBindings,
  duplicateFactChannels,
  localCopyViolationsInSource,
} from "./channels";
import {
  importEdges,
  layerOf,
  resolveImportTarget,
  srcRoot,
  walkSourceFiles,
  withoutComments,
  withoutExtension,
} from "./scan";

const SRC = srcRoot();

function fixtureSource(): string {
  return readFileSync(`${SRC}/../tests/unit/state-ownership/fixtures/duplicate-ownership.tsx`, "utf8");
}

describe("AC1: import boundaries enforce UI → feature → API/platform", () => {
  it("rejects every reverse and cross-feature deep import in src/ (whole-tree gate)", () => {
    expect(dependencyViolations(SRC)).toEqual([]);
  });

  it("classifies layers so the rules are meaningful", () => {
    expect(layerOf("routes/chat.tsx")).toBe("ui");
    expect(layerOf("components/landing/Hero.tsx")).toBe("ui");
    expect(layerOf("features/chat/ChatPage.tsx")).toBe("feature");
    expect(layerOf("api/clients.ts")).toBe("base");
    expect(layerOf("lib/auth/session.ts")).toBe("base");
    expect(layerOf("platform/geo.ts")).toBe("base");
  });

  it("keeps the map-primitive allowlist scoped to the #842 shared map family", () => {
    for (const edge of MAP_PRIMITIVE_EDGES) {
      const [from, target] = edge.split(" -> ") as [string, string];
      expect(target.startsWith("features/")).toBe(true);
      expect(target).toMatch(/features\/(bubble-map|maplibre|map-spike)\//);
      expect(from).toMatch(/features\/(chat|bubble-map|map-spike)\//);
    }
  });

  it("the map-primitive allowlist is a named, documented, reviewable set", () => {
    expect(MAP_PRIMITIVE_EDGES.length).toBeGreaterThan(0);
    expect(new Set(MAP_PRIMITIVE_EDGES).size).toBe(MAP_PRIMITIVE_EDGES.length);
  });

  it("chat feature files never import from components/ (no feature→ui reverse-edge allowlist)", () => {
    const chatFiles = walkSourceFiles(SRC).filter((file) => file.startsWith("features/chat/"));
    const uiTargets = chatFiles.flatMap((file) =>
      importEdges(readFileSync(`${SRC}/${file}`, "utf8"))
        .filter((edge) => !edge.typeOnly)
        .map((edge) => withoutExtension(resolveImportTarget(file, edge.specifier)))
        .filter((target) => target.startsWith("components/")),
    );
    expect(uiTargets).toEqual([]);
  });
});

describe("AC1: the auth UI boundary is feature-owned, not chat-owned", () => {
  it("the auth UI boundary lives at features/auth/ui and no source imports the retired chat/auth path", () => {
    const authFiles = walkSourceFiles(SRC).filter((file) => file.startsWith(`${SHARED_UI_FEATURE}/`));
    expect(authFiles.map(withoutExtension)).toEqual(
      expect.arrayContaining([
        "features/auth/ui/LoginForm",
        "features/auth/ui/LoginModal",
        "features/auth/ui/use-magic-link-form",
      ]),
    );
    const retiredEdges = walkSourceFiles(SRC).flatMap((file) =>
      importEdges(readFileSync(`${SRC}/${file}`, "utf8"))
        .map((edge) => resolveImportTarget(file, edge.specifier))
        .filter((target) => target.startsWith("features/chat/components/auth/")),
    );
    expect(retiredEdges).toEqual([]);
  });
});

describe("AC2: transport + browser storage stay behind named adapters", () => {
  it("allows storage access only inside the adapter allowlist", () => {
    expect(storageViolations(SRC)).toEqual([]);
  });

  it("every storage adapter is feature-owned (lib/ or features/), not a component", () => {
    for (const adapter of STORAGE_ADAPTERS) {
      const isBootstrap = adapter === "components/theme-bootstrap.ts";
      if (isBootstrap) continue;
      expect(adapter.startsWith("lib/") || adapter.startsWith("features/")).toBe(true);
    }
  });

  it("the theme-bootstrap entry is the single pre-hydration exception and only emits a script string", () => {
    const source = withoutComments(
      readFileSync(`${SRC}/components/theme-bootstrap.ts`, "utf8"),
    );
    const storageTokens = source.match(/localStorage|sessionStorage/gu) ?? [];
    expect(storageTokens.length).toBe(1);
    expect(source).toContain('localStorage.getItem("${THEME_STORAGE_KEY}")');
  });
});

describe("AC2 transport gate: the named ORPCError-only import is the only allowed form", () => {
  const UI_FILE = "components/TransportProbe.tsx";

  it("allows the named ORPCError-only runtime import", () => {
    expect(transportViolations(UI_FILE, 'import { ORPCError } from "@orpc/client";')).toEqual([]);
  });

  it("allows a named type-only import of transport types", () => {
    expect(transportViolations(UI_FILE, 'import type { ClientOptions } from "@orpc/openapi-client";')).toEqual([]);
  });
});

describe("AC2 transport gate: every other import form is rejected", () => {
  const UI_FILE = "components/TransportProbe.tsx";

  it("rejects a named runtime import of anything beyond ORPCError", () => {
    expect(transportViolations(UI_FILE, 'import { createClient } from "@orpc/client";')).toEqual([
      "components/TransportProbe.tsx: ui imports transport package @orpc/client",
    ]);
  });

  it("rejects a named import mixing ORPCError with another runtime member", () => {
    expect(transportViolations(UI_FILE, 'import { ORPCError, createClient } from "@orpc/client";')).toEqual([
      "components/TransportProbe.tsx: ui imports transport package @orpc/client",
    ]);
  });

  it("rejects a default import of a client factory", () => {
    expect(transportViolations(UI_FILE, 'import createClient from "@orpc/client";')).toEqual([
      "components/TransportProbe.tsx: ui imports transport package @orpc/client",
    ]);
  });

  it("rejects a namespace import", () => {
    expect(transportViolations(UI_FILE, 'import * as orpc from "@orpc/openapi-client";')).toEqual([
      "components/TransportProbe.tsx: ui imports transport package @orpc/openapi-client",
    ]);
  });

  it("rejects a side-effect import", () => {
    expect(transportViolations(UI_FILE, 'import "@orpc/client";')).toEqual([
      "components/TransportProbe.tsx: ui imports transport package @orpc/client",
    ]);
  });

  it("rejects a default import whose local name merely starts with `type` (word boundary)", () => {
    expect(transportViolations(UI_FILE, 'import typeClient from "@orpc/client";')).toEqual([
      "components/TransportProbe.tsx: ui imports transport package @orpc/client",
    ]);
  });

  it("rejects a named runtime import from a transport package subpath", () => {
    expect(transportViolations(UI_FILE, 'import { OpenAPILink } from "@orpc/openapi-client/fetch";')).toEqual([
      "components/TransportProbe.tsx: ui imports transport package @orpc/openapi-client",
    ]);
  });

  it("rejects a dynamic import of a transport package and a subpath", () => {
    expect(transportViolations(UI_FILE, 'const client = import("@orpc/client");')).toEqual([
      "components/TransportProbe.tsx: ui imports transport package @orpc/client",
    ]);
    expect(transportViolations(UI_FILE, 'const link = import("@orpc/openapi-client/fetch");')).toEqual([
      "components/TransportProbe.tsx: ui imports transport package @orpc/openapi-client",
    ]);
  });
});

describe("AC4: query results are never copied into local state", () => {
  it("finds no useState/useReducer seeded from a URL/Query/Context value anywhere in src/", () => {
    expect(localCopyViolations(SRC)).toEqual([]);
  });

  it("computed derivation stays on the query hook (use-continue-from)", () => {
    const source = readFileSync(`${SRC}/api/hooks/use-continue-from.ts`, "utf8");
    expect(source).toMatch(/pickContinueFrom\(query\.data\.saved_routes\)/);
    expect(source).not.toMatch(/useState/);
  });
});

describe("AC3: URL-owned chat state has no second durable authority", () => {
  it("the chat search facts (?q=, ?session=, ?settings=byok, ?route=) exist only in the URL parser", () => {
    const storageUsers = walkSourceFiles(SRC).filter((file) =>
      withoutComments(readFileSync(`${SRC}/${file}`, "utf8")).includes("sessionStorage") ||
      withoutComments(readFileSync(`${SRC}/${file}`, "utf8")).includes("localStorage"),
    );
    const chatStorage = storageUsers.filter((file) => file.includes("chat"));
    expect(chatStorage).toEqual([
      "features/chat/lib/draft-storage.ts",
      "features/chat/save/deferred-save.ts",
    ]);
  });
});

describe("AC6: the reviewer fixture trips the duplicate-ownership detector", () => {
  const source = fixtureSource();

  it("the fixture binds one fact on all four channels", () => {
    const bindings = channelBindings(source);
    expect(bindings.url).toContain("url");
    expect(bindings.query).toContain("query");
    expect(bindings.context).toContain("context");
    expect(bindings.local).toContain("localQ");
  });

  it("detects the fact 'q' in URL, Query cache, Context and local state", () => {
    const byFact = duplicateFactChannels(source);
    expect(byFact.get("q")).toEqual(["context", "local", "query", "url"]);
    const copies = localCopyViolationsInSource(source);
    expect(copies).toContain("local state seeded from q (a URL/Query/Context value)");
  });

  it("the whole-tree scan stays clean while the fixture is the only offender (fixtures are not src/)", () => {
    expect(duplicateFactViolations(SRC)).toEqual([]);
  });

  it("the fixture is never executed by the gate — it is parsed source (tsc + oxlint cover its type safety)", () => {
    expect(source).toContain('import { useQuery } from "@tanstack/react-query"');
    expect(source).toContain('import { useSearch } from "@tanstack/react-router"');
    expect(source).toContain("export function useDuplicateOwnershipFixture");
    expect(source).not.toMatch(/vitest|it\(|expect\(/u);
  });
});

describe("checker plumbing", () => {
  it("resolves relative specifiers against the importing file", () => {
    expect(resolveImportTarget("features/chat/ChatPage.tsx", "../lib/auth/session")).toBe("features/lib/auth/session");
    expect(resolveImportTarget("features/chat/components/ChatInput.tsx", "../../../lib/byok/byok-storage")).toBe("lib/byok/byok-storage");
  });

  it("parses type-only imports without treating them as runtime edges", () => {
    const source = 'import type { Locale } from "../../i18n/locales";\nimport { users } from "../orpc";';
    const edges = importEdges(source);
    expect(edges[0]).toMatchObject({ specifier: "../../i18n/locales", typeOnly: true });
    expect(edges[1]).toMatchObject({ specifier: "../orpc", typeOnly: false });
  });

  it("parses relative side-effect imports as real runtime edges", () => {
    const source = 'import "./styles.css";\nimport type { T } from "../types";';
    const edges = importEdges(source);
    expect(edges[0]).toMatchObject({ specifier: "./styles.css", typeOnly: false });
    expect(edges[1]).toMatchObject({ specifier: "../types", typeOnly: true });
  });
});
