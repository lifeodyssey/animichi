/**
 * ChatSummaryCard unit tests — Task C4
 *
 * AC coverage:
 * - Happy: renders fox avatar + table (area/duration/transport/spots) + CTA -> unit
 * - i18n: all copy localized -> unit
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatSummaryCard } from "@/components/generative/ChatSummaryCard";
import defaultDict from "@/lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

const baseProps = {
  summary: "鎌倉エリアの「つるね」聖地を巡る1日プランをご提案します。",
  area: "鎌倉エリア",
  duration: "約8時間",
  transport: "徒歩・江ノ電・バス",
  spotCount: 6,
  timestamp: "10:21 AM",
};

describe("ChatSummaryCard — happy path", () => {
  it("renders the summary text", () => {
    render(<ChatSummaryCard {...baseProps} />);
    expect(screen.getByText(baseProps.summary)).toBeInTheDocument();
  });

  it("renders the area value", () => {
    render(<ChatSummaryCard {...baseProps} />);
    expect(screen.getByText(baseProps.area)).toBeInTheDocument();
  });

  it("renders the duration value", () => {
    render(<ChatSummaryCard {...baseProps} />);
    expect(screen.getByText(baseProps.duration)).toBeInTheDocument();
  });

  it("renders the transport value", () => {
    render(<ChatSummaryCard {...baseProps} />);
    expect(screen.getByText(baseProps.transport)).toBeInTheDocument();
  });

  it("renders the spots count", () => {
    render(<ChatSummaryCard {...baseProps} />);
    expect(
      screen.getByText(`${baseProps.spotCount}か所`),
    ).toBeInTheDocument();
  });

  it("renders a view-details button", () => {
    render(<ChatSummaryCard {...baseProps} />);
    expect(
      screen.getByRole("button", {
        name: defaultDict.chat_summary_card.view_details,
      }),
    ).toBeInTheDocument();
  });

  it("renders an adopt-plan CTA button", () => {
    render(<ChatSummaryCard {...baseProps} />);
    expect(
      screen.getByRole("button", {
        name: defaultDict.chat_summary_card.adopt_plan,
      }),
    ).toBeInTheDocument();
  });

  it("renders a fox avatar", () => {
    const { container } = render(<ChatSummaryCard {...baseProps} />);
    expect(
      container.querySelector("[data-testid='fox-avatar']"),
    ).toBeInTheDocument();
  });
});

describe("ChatSummaryCard — i18n", () => {
  it("renders all four table row labels from dictionary", () => {
    render(<ChatSummaryCard {...baseProps} />);
    const t = defaultDict.chat_summary_card;
    expect(screen.getByText(t.area_label)).toBeInTheDocument();
    expect(screen.getByText(t.duration_label)).toBeInTheDocument();
    expect(screen.getByText(t.transport_label)).toBeInTheDocument();
    expect(screen.getByText(t.spots_label)).toBeInTheDocument();
  });

  it("renders CTA labels from dictionary", () => {
    render(<ChatSummaryCard {...baseProps} />);
    const t = defaultDict.chat_summary_card;
    expect(
      screen.getByRole("button", { name: t.view_details }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t.adopt_plan }),
    ).toBeInTheDocument();
  });
});

describe("ChatSummaryCard — callback", () => {
  it("calls onViewDetails when view-details button clicked", async () => {
    const user = userEvent.setup();
    const onViewDetails = vi.fn();
    render(<ChatSummaryCard {...baseProps} onViewDetails={onViewDetails} />);
    await user.click(
      screen.getByRole("button", {
        name: defaultDict.chat_summary_card.view_details,
      }),
    );
    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });

  it("calls onAdoptPlan when adopt-plan CTA clicked", async () => {
    const user = userEvent.setup();
    const onAdoptPlan = vi.fn();
    render(<ChatSummaryCard {...baseProps} onAdoptPlan={onAdoptPlan} />);
    await user.click(
      screen.getByRole("button", {
        name: defaultDict.chat_summary_card.adopt_plan,
      }),
    );
    expect(onAdoptPlan).toHaveBeenCalledTimes(1);
  });
});
