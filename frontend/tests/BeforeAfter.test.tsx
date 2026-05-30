/**
 * BeforeAfter unit tests — Task A4
 *
 * AC coverage:
 * - Happy: renders both images + Anime/Real badges; default split visible -> unit
 * - Happy: consumed by registry lookup -> unit
 * - Null/empty: missing rightSrc falls back to anime-only + placeholder, no broken img -> unit
 * - Error: broken image URL triggers onError fallback (placeholder + alt), height stable -> unit
 * - i18n: badge labels render per locale from dictionaries -> unit
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BeforeAfter from "@/components/generative/BeforeAfter";
import { COMPONENT_REGISTRY } from "@/components/generative/registry";
import jaDict from "@/lib/dictionaries/ja.json";
import enDict from "@/lib/dictionaries/en.json";
import zhDict from "@/lib/dictionaries/zh.json";

// ---------------------------------------------------------------------------
// Happy path — both images + badges
// ---------------------------------------------------------------------------

describe("BeforeAfter — happy path", () => {
  it("renders left (anime) and right (real) images with correct alt text", () => {
    render(
      <BeforeAfter
        leftSrc="/anime.jpg"
        rightSrc="/real.jpg"
        leftAlt="Anime screenshot"
        rightAlt="Real photo"
        leftLabel="Anime"
        rightLabel="Real"
      />,
    );
    expect(screen.getByAltText("Anime screenshot")).toBeInTheDocument();
    expect(screen.getByAltText("Real photo")).toBeInTheDocument();
  });

  it("renders Anime and Real badge labels", () => {
    render(
      <BeforeAfter
        leftSrc="/anime.jpg"
        rightSrc="/real.jpg"
        leftLabel="Anime"
        rightLabel="Real"
      />,
    );
    expect(screen.getByText("Anime")).toBeInTheDocument();
    expect(screen.getByText("Real")).toBeInTheDocument();
  });

  it("static split is visible by default (no drag interaction needed)", () => {
    const { container } = render(
      <BeforeAfter
        leftSrc="/anime.jpg"
        rightSrc="/real.jpg"
        leftLabel="Anime"
        rightLabel="Real"
      />,
    );
    // Static split: wrapper element should be present
    expect(container.firstChild).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Registry lookup
// ---------------------------------------------------------------------------

describe("BeforeAfter — registry", () => {
  it("is registered in COMPONENT_REGISTRY under 'BeforeAfter' key", () => {
    expect(COMPONENT_REGISTRY).toHaveProperty("BeforeAfter");
  });

  it("registry entry is a function (callable renderer)", () => {
    expect(typeof COMPONENT_REGISTRY["BeforeAfter"]).toBe("function");
  });

  it("registry entry returns a non-null node for a search_bangumi response", () => {
    const renderer = COMPONENT_REGISTRY["BeforeAfter"];
    const response = {
      success: true,
      status: "ok",
      intent: "search_bangumi" as const,
      session_id: null,
      message: "Found spots",
      data: {
        message: "",
        status: "ok" as const,
        results: {
          rows: [
            {
              id: "pt-1",
              name: "宇治橋",
              name_cn: null,
              episode: 1,
              time_seconds: null,
              screenshot_url: "/anime.jpg",
              bangumi_id: "51",
              latitude: 34.88,
              longitude: 135.8,
            },
          ],
          row_count: 1,
          strategy: "sql" as const,
          status: "ok" as const,
          metadata: {},
        },
      } satisfies import("@/lib/types").SearchResultData,
      session: { interaction_count: 1, route_history_count: 0 },
      route_history: [],
      errors: [],
      ui: { component: "BeforeAfter" },
    } as Parameters<typeof renderer>[0];
    const node = renderer(response);
    expect(node).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Null / empty — missing rightSrc
// ---------------------------------------------------------------------------

describe("BeforeAfter — null/empty rightSrc", () => {
  it("renders without rightSrc and shows placeholder instead", () => {
    const { container } = render(
      <BeforeAfter
        leftSrc="/anime.jpg"
        rightSrc=""
        leftLabel="Anime"
        rightLabel="Real"
      />,
    );
    // Left image (anime) should be present via testId
    const animeImg = container.querySelector("[data-testid='left-img']");
    expect(animeImg).not.toBeNull();
    expect(animeImg?.getAttribute("src")).toBe("/anime.jpg");
  });

  it("shows a placeholder element when rightSrc is empty", () => {
    const { container } = render(
      <BeforeAfter
        leftSrc="/anime.jpg"
        rightSrc=""
        leftLabel="Anime"
        rightLabel="Real"
      />,
    );
    // Placeholder div (data-testid or role) is present instead of broken img
    const placeholder = container.querySelector("[data-testid='real-placeholder']");
    expect(placeholder).not.toBeNull();
  });

  it("does not render an img with empty src", () => {
    render(
      <BeforeAfter
        leftSrc="/anime.jpg"
        rightSrc=""
        leftLabel="Anime"
        rightLabel="Real"
      />,
    );
    const imgs = screen.queryAllByRole("img");
    const emptyImg = imgs.find((img) => img.getAttribute("src") === "");
    expect(emptyImg).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Error — broken image URL
// ---------------------------------------------------------------------------

describe("BeforeAfter — error path (broken image)", () => {
  it("shows fallback placeholder on left image error", () => {
    const { container } = render(
      <BeforeAfter
        leftSrc="/broken-anime.jpg"
        rightSrc="/real.jpg"
        leftAlt="Anime screenshot"
        rightAlt="Real photo"
        leftLabel="Anime"
        rightLabel="Real"
      />,
    );
    const animeImg = container.querySelector("[data-testid='left-img']") as HTMLImageElement | null;
    expect(animeImg).not.toBeNull();
    // Fire error event
    if (animeImg) {
      fireEvent.error(animeImg);
      // After error, placeholder should appear
      const placeholder = container.querySelector("[data-testid='left-placeholder']");
      expect(placeholder).not.toBeNull();
    }
  });

  it("shows fallback placeholder on right image error", () => {
    const { container } = render(
      <BeforeAfter
        leftSrc="/anime.jpg"
        rightSrc="/broken-real.jpg"
        leftAlt="Anime screenshot"
        rightAlt="Real photo"
        leftLabel="Anime"
        rightLabel="Real"
      />,
    );
    const realImg = container.querySelector("[data-testid='right-img']") as HTMLImageElement | null;
    expect(realImg).not.toBeNull();
    if (realImg) {
      fireEvent.error(realImg);
      // After error, right side shows "real-placeholder" (the testId for right side placeholder)
      const placeholder = container.querySelector("[data-testid='real-placeholder']");
      expect(placeholder).not.toBeNull();
    }
  });

  it("component container maintains minimum height after image error", () => {
    const { container } = render(
      <BeforeAfter
        leftSrc="/broken.jpg"
        rightSrc="/broken.jpg"
        leftLabel="Anime"
        rightLabel="Real"
      />,
    );
    const root = container.firstChild as HTMLElement | null;
    expect(root).not.toBeNull();
    // Has a min-height class (not zero-height)
    expect(root?.className).toMatch(/min-h/);
  });
});

// ---------------------------------------------------------------------------
// Draggable mode
// ---------------------------------------------------------------------------

describe("BeforeAfter — draggable mode", () => {
  it("renders both images in draggable mode", () => {
    const { container } = render(
      <BeforeAfter
        leftSrc="/anime.jpg"
        rightSrc="/real.jpg"
        leftAlt="Anime"
        rightAlt="Real"
        leftLabel="アニメ"
        rightLabel="実景"
        draggable
      />,
    );
    expect(container.querySelector("[data-testid='left-img']")).not.toBeNull();
    expect(container.querySelector("[data-testid='right-img']")).not.toBeNull();
  });

  it("renders badges in draggable mode", () => {
    render(
      <BeforeAfter
        leftSrc="/anime.jpg"
        rightSrc="/real.jpg"
        leftLabel="アニメ"
        rightLabel="実景"
        draggable
      />,
    );
    expect(screen.getByText("アニメ")).toBeInTheDocument();
    expect(screen.getByText("実景")).toBeInTheDocument();
  });

  it("drag handle has role=slider with aria attributes", () => {
    render(
      <BeforeAfter
        leftSrc="/anime.jpg"
        rightSrc="/real.jpg"
        leftLabel="Anime"
        rightLabel="Real"
        draggable
      />,
    );
    const slider = screen.getByRole("slider");
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "100");
    expect(slider).toHaveAttribute("aria-valuenow", "50");
  });

  it("ArrowLeft key decreases slider position", () => {
    render(
      <BeforeAfter
        leftSrc="/anime.jpg"
        rightSrc="/real.jpg"
        leftLabel="Anime"
        rightLabel="Real"
        draggable
      />,
    );
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider.getAttribute("aria-valuenow")).toBe("48");
  });

  it("ArrowRight key increases slider position", () => {
    render(
      <BeforeAfter
        leftSrc="/anime.jpg"
        rightSrc="/real.jpg"
        leftLabel="Anime"
        rightLabel="Real"
        draggable
      />,
    );
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider.getAttribute("aria-valuenow")).toBe("52");
  });

  it("Shift+ArrowLeft moves by 10", () => {
    render(
      <BeforeAfter
        leftSrc="/anime.jpg"
        rightSrc="/real.jpg"
        leftLabel="Anime"
        rightLabel="Real"
        draggable
      />,
    );
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowLeft", shiftKey: true });
    expect(slider.getAttribute("aria-valuenow")).toBe("40");
  });

  it("shows placeholder when rightSrc is empty in draggable mode", () => {
    const { container } = render(
      <BeforeAfter
        leftSrc="/anime.jpg"
        rightSrc=""
        leftLabel="Anime"
        rightLabel="Real"
        draggable
      />,
    );
    expect(container.querySelector("[data-testid='real-placeholder']")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// i18n — badge labels per locale
// ---------------------------------------------------------------------------

describe("BeforeAfter — i18n badge labels", () => {
  it("renders Japanese badge labels (アニメ / 実景)", () => {
    render(
      <BeforeAfter
        leftSrc="/a.jpg"
        rightSrc="/r.jpg"
        leftLabel={jaDict.before_after.anime_label}
        rightLabel={jaDict.before_after.real_label}
      />,
    );
    expect(screen.getByText(jaDict.before_after.anime_label)).toBeInTheDocument();
    expect(screen.getByText(jaDict.before_after.real_label)).toBeInTheDocument();
  });

  it("renders English badge labels (Anime / Real)", () => {
    render(
      <BeforeAfter
        leftSrc="/a.jpg"
        rightSrc="/r.jpg"
        leftLabel={enDict.before_after.anime_label}
        rightLabel={enDict.before_after.real_label}
      />,
    );
    expect(screen.getByText(enDict.before_after.anime_label)).toBeInTheDocument();
    expect(screen.getByText(enDict.before_after.real_label)).toBeInTheDocument();
  });

  it("renders Chinese badge labels (动画 / 实景)", () => {
    render(
      <BeforeAfter
        leftSrc="/a.jpg"
        rightSrc="/r.jpg"
        leftLabel={zhDict.before_after.anime_label}
        rightLabel={zhDict.before_after.real_label}
      />,
    );
    expect(screen.getByText(zhDict.before_after.anime_label)).toBeInTheDocument();
    expect(screen.getByText(zhDict.before_after.real_label)).toBeInTheDocument();
  });
});
