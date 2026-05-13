import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { FloatingSpotList } from "./FloatingSpotList";
import { POINTS_UJI, POINTS_MIXED_AREAS, POINTS_MANY } from "@/stories/fixtures";

const EP_RANGES = ["EP 1-4", "EP 5-8"];
const AREAS = ["宇治", "京都", "高山"];

const meta = {
  title: "Layout/FloatingSpotList",
  component: FloatingSpotList,
  tags: ["autodocs"],
  args: {
    onToggle: fn(),
    onPointClick: fn(),
    onFilterModeChange: fn(),
    onEpRangeChange: fn(),
    onAreaChange: fn(),
    selectedIds: new Set<string>(),
    activeEpRange: null,
    activeArea: null,
    hasEpisodes: true,
  },
  decorators: [
    (Story) => (
      <div className="relative h-[600px] w-[500px] bg-muted">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FloatingSpotList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EpisodeFilter: Story = {
  args: {
    points: POINTS_UJI,
    visiblePoints: POINTS_UJI,
    filterMode: "episode",
    epRanges: EP_RANGES,
    areas: AREAS,
    totalCount: POINTS_UJI.length,
  },
};

export const AreaFilter: Story = {
  args: {
    points: POINTS_MIXED_AREAS,
    visiblePoints: POINTS_MIXED_AREAS,
    filterMode: "area",
    epRanges: EP_RANGES,
    areas: AREAS,
    totalCount: POINTS_MIXED_AREAS.length,
  },
};

export const WithSelections: Story = {
  args: {
    points: POINTS_UJI,
    visiblePoints: POINTS_UJI,
    filterMode: "episode",
    epRanges: EP_RANGES,
    areas: AREAS,
    totalCount: POINTS_UJI.length,
    selectedIds: new Set(["p1", "p3"]),
  },
};

export const ActivePoint: Story = {
  args: {
    points: POINTS_UJI,
    visiblePoints: POINTS_UJI,
    filterMode: "episode",
    epRanges: EP_RANGES,
    areas: AREAS,
    totalCount: POINTS_UJI.length,
    activePointId: "p2",
  },
};

export const MovieMode: Story = {
  args: {
    points: POINTS_MIXED_AREAS,
    visiblePoints: POINTS_MIXED_AREAS,
    filterMode: "area",
    epRanges: [],
    areas: AREAS,
    totalCount: POINTS_MIXED_AREAS.length,
    hasEpisodes: false,
  },
};

export const ManySpots: Story = {
  args: {
    points: POINTS_MANY,
    visiblePoints: POINTS_MANY.slice(0, 20),
    filterMode: "episode",
    epRanges: ["EP 1-4", "EP 5-8", "EP 9-12"],
    areas: ["宇治", "京都", "高山", "東京"],
    totalCount: POINTS_MANY.length,
  },
};

export const ActiveEpRangeChip: Story = {
  args: {
    points: POINTS_UJI,
    visiblePoints: POINTS_UJI.slice(0, 2),
    filterMode: "episode",
    epRanges: EP_RANGES,
    areas: AREAS,
    activeEpRange: "EP 1-4",
    totalCount: POINTS_UJI.length,
  },
};
