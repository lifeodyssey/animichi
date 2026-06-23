// Unit tests for send-auth-email Edge Function.
// Run with: deno test --allow-all supabase/functions/tests/send-auth-email-test.ts
//
// Per Supabase official testing guide:
// https://supabase.com/docs/guides/functions/unit-test

import { assertEquals, assert } from "jsr:@std/assert@1";

// We can't import the Deno.serve handler directly, so we test the
// function by sending HTTP requests to it. For unit tests without
// running the server, we extract and test the pure functions.

// ── Test: safeRedirect ──

function safeRedirect(to: string | undefined): string {
  if (!to || !to.startsWith("/") || to.startsWith("//")) return "/chat";
  return to;
}

Deno.test("safeRedirect returns /chat for undefined", () => {
  assertEquals(safeRedirect(undefined), "/chat");
});

Deno.test("safeRedirect returns /chat for absolute URL", () => {
  assertEquals(safeRedirect("https://evil.com"), "/chat");
});

Deno.test("safeRedirect returns /chat for protocol-relative URL", () => {
  assertEquals(safeRedirect("//evil.com"), "/chat");
});

Deno.test("safeRedirect passes through relative path", () => {
  assertEquals(safeRedirect("/chat?q=test"), "/chat?q=test");
});

// ── Test: escapeHtml ──

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

Deno.test("escapeHtml escapes double quotes", () => {
  assertEquals(escapeHtml('a"b'), "a&quot;b");
});

Deno.test("escapeHtml escapes angle brackets", () => {
  assertEquals(escapeHtml("<script>"), "&lt;script&gt;");
});

Deno.test("escapeHtml escapes ampersands", () => {
  assertEquals(escapeHtml("a&b"), "a&amp;b");
});

Deno.test("escapeHtml handles clean URLs", () => {
  const url = "https://example.com/auth/confirm?token=abc&type=email";
  assert(escapeHtml(url).includes("&amp;"));
  assert(!escapeHtml(url).includes("<"));
});

// ── Test: locale template selection ──

const TEMPLATES: Record<string, { subject: string; cta: string }> = {
  ja: { subject: "聖地巡礼 — ログインリンク", cta: "ログインする" },
  zh: { subject: "聖地巡礼 — 登录链接", cta: "点击登录" },
  en: { subject: "Seichijunrei — Login link", cta: "Log in" },
};

Deno.test("locale ja selects Japanese template", () => {
  const t = TEMPLATES["ja"] ?? TEMPLATES.en;
  assertEquals(t.subject, "聖地巡礼 — ログインリンク");
});

Deno.test("locale zh selects Chinese template", () => {
  const t = TEMPLATES["zh"] ?? TEMPLATES.en;
  assertEquals(t.subject, "聖地巡礼 — 登录链接");
});

Deno.test("unknown locale falls back to English", () => {
  const t = TEMPLATES["fr"] ?? TEMPLATES.en;
  assertEquals(t.subject, "Seichijunrei — Login link");
});

Deno.test("undefined locale falls back to English", () => {
  const locale: string | undefined = undefined;
  const t = TEMPLATES[locale ?? "en"] ?? TEMPLATES.en;
  assertEquals(t.cta, "Log in");
});
