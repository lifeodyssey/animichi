import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { ResultPanelToolbar } from "./ResultPanelToolbar";

const EP_RANGES = ["EP 1-4", "EP 5-8", "EP 9-12"];
const AREAS = ["宇治", "京都", "高山"];

const meta = {
  title: "Layout/ResultPanelToolbar",
  component: ResultPanelToolbar,
  tags: ["autodocs"],
  args: {
    onViewChange: fn(),
    onFilterModeChange: fn(),
    onEpRangeChange: fn(),
    onAreaChange: fn(),
    epRanges: EP_RANGES,
    areas: AREAS,
    activeEpRange: null,
    activeArea: null,
  },
} satisfies Meta<typeof ResultPanelToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GridEpisodeMode: Story = {
  args: {
    view: "grid",
    filterMode: "episode",
  },
};

export const MapEpisodeMode: Story = {
  args: {
    view: "map",
    filterMode: "episode",
  },
};

export const AreaMode: Story = {
  args: {
    view: "grid",
    filterMode: "area",
  },
};

export const ActiveEpRangeChip: Story = {
  args: {
    view: "grid",
    filterMode: "episode",
    activeEpRange: "EP 1-4",
  },
};

export const ActiveAreaChip: Story = {
  args: {
    view: "grid",
    filterMode: "area",
    activeArea: "宇治",
  },
};

export const NoChips: Story = {
  args: {
    view: "grid",
    filterMode: "episode",
    epRanges: [],
    areas: [],
  },
};
