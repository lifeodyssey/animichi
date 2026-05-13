import type { Meta, StoryObj } from "@storybook/react";
import { ResultPanelEmptyState } from "./ResultPanelEmptyState";

const meta = {
  title: "Layout/ResultPanelEmptyState",
  component: ResultPanelEmptyState,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="flex h-[600px] flex-col bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ResultPanelEmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
