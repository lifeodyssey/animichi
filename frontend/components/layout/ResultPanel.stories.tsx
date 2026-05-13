import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { within, userEvent } from "storybook/test";
import ResultPanel from "./ResultPanel";
import {
  POINTS_UJI,
  POINTS_MIXED_AREAS,
  POINTS_MANY,
  makeSearchResponse,
  makeRouteResponse,
} from "@/stories/fixtures";

const meta = {
  title: "Layout/ResultPanel",
  component: ResultPanel,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    onRouteConfirmed: fn(),
    defaultOrigin: "京都駅",
  },
  decorators: [
    (Story) => (
      <div className="flex h-screen flex-col bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ResultPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No response yet — shows empty/welcome state */
export const Empty: Story = {
  args: { activeResponse: null },
};

/** Loading state — no response, loading=true */
export const Loading: Story = {
  args: { activeResponse: null, loading: true },
};

/** Search results in map view (default) */
export const SearchMap: Story = {
  args: { activeResponse: makeSearchResponse(POINTS_UJI) },
};

/** Search results — switched to grid view via toolbar */
export const SearchGrid: Story = {
  args: { activeResponse: makeSearchResponse(POINTS_UJI) },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    // ResultPanel opens in map view by default; click the grid toggle in the MapViewToggle overlay
    const gridButton = await canvas.findByRole("button", { name: /グリッド|Grid|📷/i });
    await userEvent.click(gridButton);
  },
};

/** Many items — 60 spots, grid view */
export const ManyItems: Story = {
  args: { activeResponse: makeSearchResponse(POINTS_MANY) },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const gridButton = await canvas.findByRole("button", { name: /グリッド|Grid|📷/i });
    await userEvent.click(gridButton);
  },
};

/** Mixed areas — shows area filter chips */
export const AreaFilter: Story = {
  args: { activeResponse: makeSearchResponse(POINTS_MIXED_AREAS) },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const gridButton = await canvas.findByRole("button", { name: /グリッド|Grid|📷/i });
    await userEvent.click(gridButton);
    // Switch to area filter tab
    const areaTab = await canvas.findByRole("button", { name: /地区|Area|按地区/i });
    await userEvent.click(areaTab);
  },
};

/** Route result */
export const RouteResult: Story = {
  args: { activeResponse: makeRouteResponse(POINTS_UJI) },
};
