import type { Meta, StoryObj } from "@storybook/react";
import { ChatSummaryCard } from "./ChatSummaryCard";

const meta = {
  title: "Generative/ChatSummaryCard",
  component: ChatSummaryCard,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Chat message card showing a tabular route summary (area, duration, transport, spots) from the AI assistant, with a fox avatar and two CTA buttons (view details + adopt plan).",
      },
    },
  },
  tags: ["autodocs"],
  decorators: [
    (Story: React.ComponentType) => (
      <div style={{ width: 380, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatSummaryCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    summary:
      "鎌倉エリアの「つるね」聖地を巡る1日プランをご提案します。全6スポット、徒歩と公共交通で無理なく回れるルートです。",
    area: "鎌倉エリア",
    duration: "約8時間",
    transport: "徒歩・江ノ電・バス",
    spotCount: 6,
    timestamp: "10:21 AM",
    onViewDetails: () => console.log("view details"),
    onAdoptPlan: () => console.log("adopt plan"),
  },
};

export const WithFoxAvatar: Story = {
  name: "With fox avatar image",
  args: {
    summary: "宇治エリアの響け！ユーフォニアム聖地を巡るルートです。",
    area: "宇治エリア",
    duration: "約5時間",
    transport: "徒歩・近鉄",
    spotCount: 9,
    timestamp: "14:05 PM",
    foxSrc: "/images/landing/fox-guide-v3/fox-welcome.webp",
    onViewDetails: () => {},
    onAdoptPlan: () => {},
  },
};

export const NoTimestamp: Story = {
  name: "No timestamp",
  args: {
    summary: "新宿から巡る君の名は。聖地ルートです。",
    area: "新宿",
    duration: "約3時間",
    transport: "徒歩・地下鉄",
    spotCount: 4,
    onViewDetails: () => {},
    onAdoptPlan: () => {},
  },
};
