/**
 * SpotDetail unit tests — Task D2
 *
 * AC coverage:
 * - Happy: spot detail shows BeforeAfter block + add/remove control + nearby points -> unit
 * - Null/empty: spot with no real-photo pair degrades to anime-only via BeforeAfter fallback -> unit
 * - Error: add/remove toggles selection state correctly and is idempotent on rapid double-click -> unit
 * - i18n: detail labels and add/remove CTA localized -> unit
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PilgrimagePoint } from "@/lib/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDict = {
  spot_detail: {
    back: "Back",
    episode: "Ep. {ep}",
    address_label: "Address:",
    timestamp_label: "Screenshot time:",
    add_spot: "Add to route",
    remove_spot: "Remove from route",
    view_on_map: "View on map",
    nearby_title: "Nearby spots",
    comparison_title: "Anime vs Reality",
  },
  before_after: {
    anime_label: "Anime",
    real_label: "Real",
  },
};

vi.mock("@/lib/i18n-context", () => ({
  useDict: vi.fn(() => mockDict),
  useLocale: vi.fn(() => "en"),
}));

vi.mock("next/dynamic", () => ({
  default: (_loader: unknown) => {
    const LazyMap = () => <div data-testid="lazy-map" />;
    LazyMap.displayName = "LazyMap";
    return LazyMap;
  },
}));

import SpotDetail from "@/components/generative/SpotDetail";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makePoint(overrides: Partial<PilgrimagePoint> = {}): PilgrimagePoint {
  return {
    id: "pt-1",
    name: "宇治橋",
    name_cn: "宇治桥",
    episode: 2,
    time_seconds: 135,
    screenshot_url: "/anime-frame.jpg",
    real_photo_url: "/real-photo.jpg",
    bangumi_id: "51",
    latitude: 34.88,
    longitude: 135.8,
    title: "響け！ユーフォニアム",
    title_cn: "吹响吧！上低音号",
    ...overrides,
  };
}

function makeNearby(): PilgrimagePoint[] {
  return [
    makePoint({ id: "pt-2", name: "宇治神社", name_cn: null }),
    makePoint({ id: "pt-3", name: "平等院", name_cn: "平等院" }),
  ];
}

// ---------------------------------------------------------------------------
// Happy path — BeforeAfter block + add/remove + nearby
// ---------------------------------------------------------------------------

describe("SpotDetail — happy path", () => {
  it("renders the anime screenshot in the BeforeAfter left side", () => {
    const { container } = render(
      <SpotDetail
        point={makePoint()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
        isSelected={false}
        nearbyPoints={makeNearby()}
      />,
    );
    const animeImg = container.querySelector("[data-testid='left-img']");
    expect(animeImg).not.toBeNull();
    expect(animeImg?.getAttribute("src")).toBe("/anime-frame.jpg");
  });

  it("renders the real photo in the BeforeAfter right side", () => {
    const { container } = render(
      <SpotDetail
        point={makePoint()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
        isSelected={false}
        nearbyPoints={makeNearby()}
      />,
    );
    const realImg = container.querySelector("[data-testid='right-img']");
    expect(realImg).not.toBeNull();
    expect(realImg?.getAttribute("src")).toBe("/real-photo.jpg");
  });

  it("renders anime and real badge labels from dictionary", () => {
    render(
      <SpotDetail
        point={makePoint()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
        isSelected={false}
        nearbyPoints={makeNearby()}
      />,
    );
    expect(screen.getByText("Anime")).toBeInTheDocument();
    expect(screen.getByText("Real")).toBeInTheDocument();
  });

  it("renders add-to-route button when not selected", () => {
    render(
      <SpotDetail
        point={makePoint()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
        isSelected={false}
        nearbyPoints={[]}
      />,
    );
    expect(screen.getByRole("button", { name: "Add to route" })).toBeInTheDocument();
  });

  it("renders remove-from-route button when selected", () => {
    render(
      <SpotDetail
        point={makePoint()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
        isSelected={true}
        nearbyPoints={[]}
      />,
    );
    expect(screen.getByRole("button", { name: "Remove from route" })).toBeInTheDocument();
  });

  it("renders nearby points list", () => {
    render(
      <SpotDetail
        point={makePoint()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
        isSelected={false}
        nearbyPoints={makeNearby()}
      />,
    );
    expect(screen.getByText("宇治神社")).toBeInTheDocument();
    expect(screen.getByText("平等院")).toBeInTheDocument();
  });

  it("renders nearby section heading", () => {
    render(
      <SpotDetail
        point={makePoint()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
        isSelected={false}
        nearbyPoints={makeNearby()}
      />,
    );
    expect(screen.getByText("Nearby spots")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Null / empty — no real photo → anime-only fallback
// ---------------------------------------------------------------------------

describe("SpotDetail — null real photo fallback", () => {
  it("shows right-side placeholder when real_photo_url is null", () => {
    const { container } = render(
      <SpotDetail
        point={makePoint({ real_photo_url: null })}
        onBack={vi.fn()}
        onSelect={vi.fn()}
        isSelected={false}
        nearbyPoints={[]}
      />,
    );
    const placeholder = container.querySelector("[data-testid='real-placeholder']");
    expect(placeholder).not.toBeNull();
  });

  it("shows right-side placeholder when real_photo_url is undefined", () => {
    const { container } = render(
      <SpotDetail
        point={makePoint({ real_photo_url: undefined })}
        onBack={vi.fn()}
        onSelect={vi.fn()}
        isSelected={false}
        nearbyPoints={[]}
      />,
    );
    const placeholder = container.querySelector("[data-testid='real-placeholder']");
    expect(placeholder).not.toBeNull();
  });

  it("still renders anime frame when real photo is missing", () => {
    const { container } = render(
      <SpotDetail
        point={makePoint({ real_photo_url: null })}
        onBack={vi.fn()}
        onSelect={vi.fn()}
        isSelected={false}
        nearbyPoints={[]}
      />,
    );
    const animeImg = container.querySelector("[data-testid='left-img']");
    expect(animeImg).not.toBeNull();
    expect(animeImg?.getAttribute("src")).toBe("/anime-frame.jpg");
  });
});

// ---------------------------------------------------------------------------
// Error path — add/remove toggle idempotency
// ---------------------------------------------------------------------------

describe("SpotDetail — add/remove toggle idempotency", () => {
  it("calls onSelect once on single click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <SpotDetail
        point={makePoint()}
        onBack={vi.fn()}
        onSelect={onSelect}
        isSelected={false}
        nearbyPoints={[]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add to route" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("pt-1");
  });

  it("does not call onSelect twice on rapid double-click (idempotent guard)", () => {
    const onSelect = vi.fn();
    render(
      <SpotDetail
        point={makePoint()}
        onBack={vi.fn()}
        onSelect={onSelect}
        isSelected={false}
        nearbyPoints={[]}
      />,
    );
    const btn = screen.getByRole("button", { name: "Add to route" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("calls onBack when back button is clicked", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(
      <SpotDetail
        point={makePoint()}
        onBack={onBack}
        onSelect={vi.fn()}
        isSelected={false}
        nearbyPoints={[]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// i18n — detail labels localized
// ---------------------------------------------------------------------------

describe("SpotDetail — i18n", () => {
  it("renders add_spot CTA from dictionary", () => {
    render(
      <SpotDetail
        point={makePoint()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
        isSelected={false}
        nearbyPoints={[]}
      />,
    );
    expect(screen.getByRole("button", { name: "Add to route" })).toBeInTheDocument();
  });

  it("renders remove_spot CTA from dictionary when selected", () => {
    render(
      <SpotDetail
        point={makePoint()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
        isSelected={true}
        nearbyPoints={[]}
      />,
    );
    expect(screen.getByRole("button", { name: "Remove from route" })).toBeInTheDocument();
  });

  it("renders view_on_map label from dictionary", () => {
    render(
      <SpotDetail
        point={makePoint()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
        isSelected={false}
        nearbyPoints={[]}
      />,
    );
    expect(screen.getByRole("link", { name: "View on map" })).toBeInTheDocument();
  });

  it("renders back label from dictionary", () => {
    render(
      <SpotDetail
        point={makePoint()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
        isSelected={false}
        nearbyPoints={[]}
      />,
    );
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });
});
