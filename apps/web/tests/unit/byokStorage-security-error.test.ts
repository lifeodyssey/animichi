/**
 * @vitest-environment jsdom
 *
 * Reproduces Safari's partitioned/blocked-storage behaviour: reading the
 * `sessionStorage` *property* (not just calling `.getItem`) throws. This is
 * exactly the shape a `typeof window.sessionStorage` check would already
 * have evaluated — so guarding only the subsequent method calls would not
 * have caught it. Without a try/catch around the property read itself, this
 * would previously have propagated out of `byokHeaders()` and failed every
 * chat turn for a user who has never touched BYOK (Opus P1-2).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  byokHeaders,
  clearByokConfig,
  getByokConfig,
  getByokVisionSupported,
  saveByokConfig,
  setByokVisionSupported,
} from "../../src/lib/byok/byokStorage";
import type { ByokConfig } from "../../src/lib/byok/byokStorage";

const OPENAI_CONFIG: ByokConfig = {
  provider: "openai-compatible",
  apiKey: "sk-test-key",
  model: "gpt-5",
};

const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");

function blockSessionStorage(): void {
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    get(): Storage {
      throw new DOMException("blocked", "SecurityError");
    },
  });
}

function restoreSessionStorage(): void {
  if (original) Object.defineProperty(window, "sessionStorage", original);
}

/**
 * A distinct failure shape from `blockSessionStorage()`: the property itself
 * is readable (a real `Storage`), but the method call throws — e.g. a
 * quota/security restriction enforced per-operation rather than on access.
 * jsdom's `Storage` intercepts all property access through its own
 * mechanism, so overriding the instance's `.getItem` directly is silently
 * ignored — spying on `Storage.prototype.getItem` is what actually takes
 * effect.
 */
function blockGetItem(): void {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
}

/** The `safeSet` counterpart: Safari private-mode quota exhaustion throws
 * `QuotaExceededError` from `.setItem()` itself, property access unaffected.
 * Without this test, `safeSet`'s catch block was only "covered" by an
 * accessor-level block that never reaches the method call — a false-positive
 * signal, per review. */
function blockSetItem(): void {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("quota exceeded", "QuotaExceededError");
  });
}

afterEach(() => {
  restoreSessionStorage();
  vi.restoreAllMocks();
  clearByokConfig();
});

describe("SecurityError from the sessionStorage accessor itself (Opus P1-2)", () => {
  it("getByokConfig() returns null instead of throwing", () => {
    blockSessionStorage();
    expect(() => getByokConfig()).not.toThrow();
    expect(getByokConfig()).toBeNull();
  });

  it("byokHeaders() returns {} instead of throwing — the failure mode this guard exists for", () => {
    blockSessionStorage();
    expect(() => byokHeaders()).not.toThrow();
    expect(byokHeaders()).toEqual({});
  });

  it("saveByokConfig()/clearByokConfig()/setByokVisionSupported() degrade to no-ops instead of throwing", () => {
    blockSessionStorage();
    expect(() => saveByokConfig(OPENAI_CONFIG)).not.toThrow();
    expect(saveByokConfig(OPENAI_CONFIG)).toEqual({ ok: true });
    expect(() => {
      clearByokConfig();
    }).not.toThrow();
    expect(() => {
      setByokVisionSupported(true);
    }).not.toThrow();
    expect(getByokVisionSupported()).toBeNull();
  });
});

describe("SecurityError from a storage method call, distinct from the accessor (Opus P1-2)", () => {
  it("getByokConfig() returns null instead of throwing when .getItem() itself throws", () => {
    blockGetItem();
    expect(() => getByokConfig()).not.toThrow();
    expect(getByokConfig()).toBeNull();
  });
});

describe("QuotaExceededError from .setItem() itself (P3 — genuine safeSet catch coverage)", () => {
  it("saveByokConfig() reports ok:true (validation passed) but does not throw when the write itself fails", () => {
    blockSetItem();
    expect(() => saveByokConfig(OPENAI_CONFIG)).not.toThrow();
    expect(saveByokConfig(OPENAI_CONFIG)).toEqual({ ok: true });
    expect(getByokConfig()).toBeNull();
  });

  it("setByokVisionSupported() degrades to a no-op instead of throwing when .setItem() fails", () => {
    // Requires a config already in storage (see the orphan-flag guard), so
    // block .setItem() only after a real save has already succeeded.
    saveByokConfig(OPENAI_CONFIG);
    blockSetItem();
    expect(() => {
      setByokVisionSupported(true);
    }).not.toThrow();
    expect(getByokVisionSupported()).toBeNull();
  });
});
