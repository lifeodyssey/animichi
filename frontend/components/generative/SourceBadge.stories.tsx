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
    screenshotUrl: "https://image.anitabi.cn/bangumi/51/ep/00/202012210230491.jpg",
    episode: 3,
  },
};

export const UserPhoto: Story = {
  args: {
    screenshotUrl: "https://image.anitabi.cn/user/abc123/photo.jpg",
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
    screenshotUrl: "https://image.anitabi.cn/bangumi/51/ep/00/example.jpg",
    episode: null,
  },
};

export const CustomEpisodeLabel: Story = {
  args: {
    screenshotUrl: "https://image.anitabi.cn/bangumi/51/ep/00/example.jpg",
    episode: 12,
    episodeLabel: "第12話",
  },
};
