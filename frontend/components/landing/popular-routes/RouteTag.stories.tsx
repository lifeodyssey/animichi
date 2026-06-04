// no-design-target: design-system primitive / sub-component below the hero blueprint granularity
import type { Meta, StoryObj } from "@storybook/react";
import RouteTag from "./RouteTag";

const meta = {
  title: "Landing/PopularRoutes/RouteTag",
  component: RouteTag,
} satisfies Meta<typeof RouteTag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: "school" },
  render: (args) => (
    <div className="bg-background p-6 font-sans text-fg">
      <RouteTag {...args} />
    </div>
  ),
};
