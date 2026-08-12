/**
 * State-ownership architecture gate for `apps/web/src` (issue #1009).
 *
 * AC1 — import boundaries: route/component → feature → API/platform, never
 *       reverse; cross-feature deep runtime imports rejected (the #842
 *       map-primitive edges and the shared `features/auth/ui` login-wall
 *       boundary are the only exempt edges). No feature→UI reverse-edge
 *       allowlist exists — the turnstile gate stays chat-owned.
 *
 * Every rule runs over the whole `src/` tree, so a new violation fails the
 * gate here before review — the machine-enforced replacement for the
 * peer-review-only back-edge rule that `apps/web/AGENTS.md` used to describe.
 * The AC2 adapter/transport gate and the AC3/4/6 state rules live in the
 * sibling `architecture-adapters.test.ts` and `architecture-state.test.ts`
 * files.
 *
 * The suite pins a deterministic fixed clock (issue #1009 review) so nothing
 * here ever depends on wall-clock time.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAP_PRIMITIVE_EDGES, SHARED_UI_FEATURE, dependencyViolations } from "./checker";
import { importEdges, layerOf, resolveImportTarget, sourceLangOf, srcRoot, walkSourceFiles, withoutExtension } from "./scan";

const SRC = srcRoot();
const FIXED_NOW = 1_750_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

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
      importEdges(readFileSync(`${SRC}/${file}`, "utf8"), sourceLangOf(file))
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
      importEdges(readFileSync(`${SRC}/${file}`, "utf8"), sourceLangOf(file))
        .map((edge) => resolveImportTarget(file, edge.specifier))
        .filter((target) => target.startsWith("features/chat/components/auth/")),
    );
    expect(retiredEdges).toEqual([]);
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

  it("classifies inline type-only named imports as type-only, aliases included", () => {
    const source = [
      'import { type Locale } from "./locales";',
      'import { type Locale as L } from "./locales";',
      'import { type A, type B } from "./types";',
    ].join("\n");
    const edges = importEdges(source);
    expect(edges[0]).toMatchObject({ specifier: "./locales", typeOnly: true });
    expect(edges[1]).toMatchObject({ specifier: "./locales", typeOnly: true });
    expect(edges[2]).toMatchObject({ specifier: "./types", typeOnly: true });
  });

  it("keeps mixed named imports and type-looking aliases as runtime edges", () => {
    const source = 'import { type Locale, users } from "./bundle";\nimport { ORPCError as typeError } from "./errors";';
    const edges = importEdges(source);
    expect(edges[0]).toMatchObject({ specifier: "./bundle", typeOnly: false });
    expect(edges[1]).toMatchObject({ specifier: "./errors", typeOnly: false });
  });
});

describe("checker plumbing: static dynamic imports", () => {
  it("parses static dynamic imports of relative specifiers as runtime edges", () => {
    const source = 'import type { T } from "../types";\nconst map = import("../components/Map");';
    expect(importEdges(source)).toEqual([
      { specifier: "../types", typeOnly: true },
      { specifier: "../components/Map", typeOnly: false },
    ]);
  });

  it("ignores non-relative dynamic imports — package edges, not layer edges", () => {
    const source = 'const query = import("@tanstack/react-query");\nimport "./styles.css";';
    const edges = importEdges(source);
    expect(edges.map((edge) => edge.specifier)).toEqual(["./styles.css"]);
  });

  it("ignores relative dynamic-import text inside a comment and a string literal", () => {
    const source = `// import("../components/Map")
const s = 'import("../components/Map")';`;
    expect(importEdges(source)).toEqual([]);
  });

  it("does not treat a template-literal dynamic import as an edge", () => {
    const source = 'const map = import(`../components/${name}`);\nconst plain = import(`./x`);';
    expect(importEdges(source)).toEqual([]);
  });

  it("resolves static dynamic imports against the importing file", () => {
    const source = 'const controller = import("./bubble-map-controller");';
    const specifier = importEdges(source)[0]?.specifier ?? "";
    expect(resolveImportTarget("features/chat/components/ChatPage.tsx", specifier)).toBe(
      "features/chat/components/bubble-map-controller",
    );
  });
});

describe("checker plumbing: parser dialect selection", () => {
  it("maps real file extensions to their parse dialects", () => {
    expect(sourceLangOf("routes/chat.tsx")).toBe("tsx");
    expect(sourceLangOf("lib/auth/session.ts")).toBe("ts");
  });

  it("a TS generic arrow never hides a following relative dynamic import", () => {
    const source = 'const id = <T>(value: T) => value;\nconst map = import("../components/Map");';
    expect(importEdges(source)).toEqual([{ specifier: "../components/Map", typeOnly: false }]);
    expect(importEdges(source, sourceLangOf("features/chat/lib/snippet.ts"))).toEqual([
      { specifier: "../components/Map", typeOnly: false },
    ]);
  });

  it("the real .tsx checker path parses JSX without dropping dynamic imports", () => {
    const source = 'const el = <div className="x" />;\nconst map = import("../components/Map");';
    expect(importEdges(source, sourceLangOf("components/MapHost.tsx"))).toEqual([
      { specifier: "../components/Map", typeOnly: false },
    ]);
  });

  it("fails loudly rather than silently dropping dynamic imports on unparseable source", () => {
    expect(() => importEdges("const = ;;; ((", "ts")).toThrow();
  });
});
