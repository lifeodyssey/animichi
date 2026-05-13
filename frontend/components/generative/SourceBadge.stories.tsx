import type { Meta, StoryObj } from "@storybook/react";
import SourceBadge from "./SourceBadge";

const meta = {
  title: "Generative/SourceBadge",
  component: SourceBadge,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="relative h-40 w-56 overflow-hidden rounded-lg bg-muted">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SourceBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AnimeScreenshot: Story = {
  args: {
    screenshotUrl: "https://image.anitabi.cn/points/51/5c4dgq9t5_1673198683058.jpg?plan=h160",
    episode: 3,
  },
};

export const UserPhoto: Story = {
  args: {
    screenshotUrl: "https://image.anitabi.cn/points/51/5c4dgq9dw_1673198683976.jpg?plan=h160",
    episode: null,
  },
};

export const EpisodeBadgeOnly: Story = {
  args: {
    screenshotUrl: null,
    episode: 7,
  },
};

export const NoEpisode: Story = {
  args: {
    screenshotUrl: "https://image.anitabi.cn/points/51/5c4dgq9g7_1673198685092.jpg?plan=h160",
    episode: null,
  },
};

export const CustomEpisodeLabel: Story = {
  args: {
    screenshotUrl: "https://image.anitabi.cn/points/51/5c4dgq9g7_1673198685092.jpg?plan=h160",
    episode: 12,
    episodeLabel: "第12話",
  },
};
