// no-design-target: design-system primitive / sub-component below the hero blueprint granularity
import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import RouteCard from "./RouteCard";

const meta = {
  title: "Landing/PopularRoutes/RouteCard",
  component: RouteCard,
  parameters: { layout: "centered" },
} satisfies Meta<typeof RouteCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    item: {
      bangumiId: "115908",
      title: "響け！ユーフォニアム",
      count: "156 スポット · 宇治市",
    },
    index: 0,
    addRevealRef: fn(),
  },
  render: (args) => (
    <div className="w-[280px] bg-background font-sans text-fg">
      <RouteCard {...args} />
    </div>
  ),
};
