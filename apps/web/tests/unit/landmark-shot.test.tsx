/**
 * @vitest-environment jsdom
 */
import { ANITABI_THUMBNAIL_PLAN } from "@animichi/contract/anitabi-display";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LandmarkShot, type LandmarkImage } from "../../src/lib/landmark-shot";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const IMAGE: LandmarkImage = {
  src: "https://cdn.test/scene.jpg",
  alt: "宇治橋",
  plan: ANITABI_THUMBNAIL_PLAN,
};

describe("LandmarkShot pairing", () => {
  it("renders origin text as a working origin_url link beside the screenshot", () => {
    render(
      <LandmarkShot
        image={IMAGE}
        credit={{ origin: "バンダイチャンネル", originUrl: "https://www.b-ch.com/ttl/index.php?ttl_c=1" }}
      />,
    );
    const img = screen.getByRole("img", { name: "宇治橋" });
    const credit = screen.getByRole("link", { name: "バンダイチャンネル" });
    expect(img.closest("figure")).toBe(credit.closest("figure"));
    expect(credit.getAttribute("href")).toBe("https://www.b-ch.com/ttl/index.php?ttl_c=1");
    expect(img.getAttribute("src")).toBe("https://cdn.test/scene.jpg?plan=h160");
  });

  it("shows origin text without a link when origin_url is omitted", () => {
    render(<LandmarkShot image={IMAGE} credit={{ origin: "スタジオ" }} />);
    expect(screen.getByText("スタジオ")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("falls back to Anitabi when the point has no origin", () => {
    render(<LandmarkShot image={IMAGE} credit={{}} />);
    expect(screen.getByText("Anitabi")).toBeTruthy();
  });
});

function idleObserver() {
  return class {
    observe(): void { /* stay hidden */ }
    unobserve(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
    takeRecords(): IntersectionObserverEntry[] { return []; }
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds = [];
  };
}

function reportingObserver(intersecting: boolean) {
  return class {
    constructor(private readonly cb: IntersectionObserverCallback) {}
    observe(el: Element): void {
      this.cb(
        [{ isIntersecting: intersecting, target: el } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    unobserve(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
    takeRecords(): IntersectionObserverEntry[] { return []; }
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds: number[] = [];
  };
}

describe("LandmarkShot lazy fetch", () => {
  it("does not fetch an off-screen landmark image", () => {
    vi.stubGlobal("IntersectionObserver", idleObserver());
    render(<LandmarkShot image={IMAGE} credit={{ origin: "Anitabi" }} />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "宇治橋" }).tagName).not.toBe("IMG");
  });

  it("fetches once the landmark enters the viewport", async () => {
    vi.stubGlobal("IntersectionObserver", reportingObserver(true));
    render(<LandmarkShot image={IMAGE} credit={{ origin: "Anitabi" }} />);
    const img = await screen.findByRole("img", { name: "宇治橋" });
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("https://cdn.test/scene.jpg?plan=h160");
  });

  it("stays unloaded when the observer reports the shot is still off-screen", () => {
    vi.stubGlobal("IntersectionObserver", reportingObserver(false));
    render(<LandmarkShot image={IMAGE} credit={{ origin: "Anitabi" }} />);
    expect(document.querySelector("img")).toBeNull();
  });
});
