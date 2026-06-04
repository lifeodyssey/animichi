// no-design-target: design-system primitive / sub-component below the hero blueprint granularity
import type { Meta, StoryObj } from "@storybook/react";
import BrowseBanner from "./BrowseBanner";

const meta = {
  title: "Landing/PopularRoutes/BrowseBanner",
  component: BrowseBanner,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof BrowseBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    note: "No account needed to look around — log in only when you want to save a route.",
  },
  render: (args) => (
    <div className="bg-background px-8 pb-8 pt-16 font-sans text-fg">
      <BrowseBanner {...args} />
    </div>
  ),
};
