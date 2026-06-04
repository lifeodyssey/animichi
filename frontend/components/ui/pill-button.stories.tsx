// no-design-target: design-system primitive / sub-component below the hero blueprint granularity
import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { PillButton } from "./pill-button";

const meta = {
  title: "UI/PillButton",
  component: PillButton,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    surface: {
      control: "select",
      options: ["background", "card"],
    },
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
    },
  },
  args: { onClick: fn() },
} satisfies Meta<typeof PillButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: "ブラウジングを続ける" },
};

export const SurfaceBackground: Story = {
  name: "Surface: Background",
  args: { surface: "background", children: "すべて見る" },
};

export const SurfaceCard: Story = {
  name: "Surface: Card",
  args: { surface: "card", children: "すべて見る" },
};

export const AllSurfaces: Story = {
  name: "All Surfaces",
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <PillButton {...args} surface="background">
        background
      </PillButton>
      <PillButton {...args} surface="card">
        card
      </PillButton>
    </div>
  ),
};
