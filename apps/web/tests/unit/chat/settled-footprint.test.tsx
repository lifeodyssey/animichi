/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SettledFootprint } from "../../../src/features/chat/components/SettledFootprint";
import { chatDictFor } from "../../../src/features/chat/i18n";

const ja = chatDictFor("ja");

afterEach(cleanup);

describe("B4 SettledFootprint", () => {
  it("collapses the pipeline into an expandable row with the elapsed time", () => {
    render(
      <SettledFootprint elapsedLabel="9.2s" dict={ja}>
        <span>resolve_anime</span>
      </SettledFootprint>,
    );
    expect(screen.getByText("9.2s")).toBeTruthy();
    expect(screen.getByText(ja.footprintDetails, { exact: false })).toBeTruthy();
  });

  it("keeps the collapsed pipeline steps in the DOM for expansion", () => {
    render(
      <SettledFootprint elapsedLabel="9.2s" dict={ja}>
        <span>plan_route</span>
      </SettledFootprint>,
    );
    expect(screen.getByText("plan_route")).toBeTruthy();
  });

  it("omits the elapsed emphasis when no duration is known", () => {
    const { container } = render(
      <SettledFootprint dict={ja}>
        <span>search_bangumi</span>
      </SettledFootprint>,
    );
    expect(container.querySelector(".chat-settled__elapsed")).toBeNull();
  });
});
