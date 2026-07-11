/**
 * @vitest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Landing } from "../../src/components/Landing";

describe("Landing", () => {
  it("renders the Animichi wordmark", () => {
    render(<Landing />);

    expect(screen.getByRole("heading", { name: "Animichi" })).toBeTruthy();
  });
});
