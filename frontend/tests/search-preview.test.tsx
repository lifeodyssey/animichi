/**
 * Unit tests for /search preview page and API client.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Dict } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";
import { fetchSearchPreview } from "@/lib/api/search-preview";

const jaFull = jaDict as unknown as Dict;

vi.mock("@/lib/i18n-context", () => ({
  useDict: vi.fn(() => jaFull),
  useLocale: vi.fn(() => "ja"),
  useSetLocale: vi.fn(() => vi.fn()),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ replace: vi.fn(), push: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams("q=響け！ユーフォニアム")),
  usePathname: vi.fn(() => "/search"),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock fetch for the API call
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: false,
    status: 404,
  } as Response),
);

import SearchPage from "@/app/search/page";

describe("Search preview page", () => {
  it("renders title with query parameter", () => {
    render(<SearchPage />);
    expect(
      screen.getByText("響け！ユーフォニアム の聖地"),
    ).toBeInTheDocument();
  });

  it("renders back to home link", () => {
    render(<SearchPage />);
    expect(screen.getByText("トップに戻る")).toBeInTheDocument();
  });

  it("renders header with brand name", () => {
    render(<SearchPage />);
    const logos = screen.getAllByText("聖地巡礼");
    expect(logos.length).toBeGreaterThanOrEqual(1);
  });
});

describe("fetchSearchPreview", () => {
  it("returns empty result on 404", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 404 } as Response),
    );
    const result = await fetchSearchPreview("nonexistent");
    expect(result.results.status).toBe("empty");
    expect(result.results.rows).toHaveLength(0);
  });

  it("throws on non-404 errors", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500 } as Response),
    );
    await expect(fetchSearchPreview("test")).rejects.toThrow(
      "Search preview failed (500)",
    );
  });

  it("parses successful response", async () => {
    const mockResponse = {
      results: {
        rows: [{ id: "1", name: "test", latitude: 0, longitude: 0 }],
        row_count: 1,
        total_available: 10,
        preview_limit: 5,
        status: "ok",
      },
      auth_required_for_full: true,
      message: "",
    };
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response),
    );
    const result = await fetchSearchPreview("響け");
    expect(result.results.rows).toHaveLength(1);
    expect(result.auth_required_for_full).toBe(true);
  });
});
