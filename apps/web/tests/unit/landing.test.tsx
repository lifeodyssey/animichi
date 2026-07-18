/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Landing } from "../../src/components/Landing";

function setLanguages(langs: string[]): void {
  Object.defineProperty(navigator, "languages", { value: langs, configurable: true });
}

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(cleanup);

describe("Landing", () => {
  it("provides the locale context and renders the hero", () => {
    render(<Landing />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("聖地巡礼");
    expect(document.documentElement.lang).toBe("ja");
  });
});
