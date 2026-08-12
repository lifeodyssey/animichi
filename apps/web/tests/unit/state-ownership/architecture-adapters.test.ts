/**
 * AC2 transport + storage gate for `apps/web/src` (issue #1009): UI never
 * calls transport clients, and browser storage only lives inside the named
 * feature-owned adapter allowlist (plus the documented pre-hydration bootstrap
 * exception, whose `localStorage` reference sits inside an emitted script
 * string, not in module code).
 *
 * The suite pins a deterministic fixed clock (issue #1009 review) so nothing
 * here ever depends on wall-clock time.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_ADAPTERS, storageViolations, transportViolations } from "./checker";
import { srcRoot, withoutComments } from "./scan";

const SRC = srcRoot();
const FIXED_NOW = 1_750_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AC2: browser storage stays behind the named adapters", () => {
  it("allows storage access only inside the adapter allowlist", () => {
    expect(storageViolations(SRC)).toEqual([]);
  });

  it("every storage adapter except the theme-bootstrap entry is feature-owned", () => {
    const adapters = STORAGE_ADAPTERS.filter((adapter) => adapter !== "components/theme-bootstrap.ts");
    for (const adapter of adapters) {
      expect(adapter.startsWith("lib/") || adapter.startsWith("features/")).toBe(true);
    }
  });

  it("the theme-bootstrap entry is the single storage adapter outside lib/ and features/", () => {
    const exceptions = STORAGE_ADAPTERS.filter(
      (adapter) => !adapter.startsWith("lib/") && !adapter.startsWith("features/"),
    );
    expect(exceptions).toEqual(["components/theme-bootstrap.ts"]);
  });

  it("the theme-bootstrap entry only emits a script string", () => {
    const source = withoutComments(readFileSync(`${SRC}/components/theme-bootstrap.ts`, "utf8"));
    const storageTokens = source.match(/localStorage|sessionStorage/gu) ?? [];
    expect(storageTokens).toHaveLength(1);
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
