// no-design-target: design-system primitive / sub-component below the hero blueprint granularity
import type { Meta, StoryObj } from "@storybook/react";
import MiniSearch from "./MiniSearch";

const meta = {
  title: "Landing/HowItWorks/MiniSearch",
  component: MiniSearch,
  parameters: { layout: "centered" },
} satisfies Meta<typeof MiniSearch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
