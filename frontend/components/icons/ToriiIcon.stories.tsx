import type { Meta, StoryObj } from "@storybook/react";
import ToriiIcon from "./ToriiIcon";

const meta = {
  title: "Icons/ToriiIcon",
  component: ToriiIcon,
  tags: ["autodocs"],
} satisfies Meta<typeof ToriiIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { size: 32 } };
export const Small: Story = { args: { size: 16 } };
export const Large: Story = { args: { size: 64 } };
