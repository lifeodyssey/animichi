// no-design-target: design-system primitive / sub-component below the hero blueprint granularity
import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { Chip } from "./chip";

const meta = {
  title: "UI/Chip",
  component: Chip,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    tone: {
      control: "select",
      options: ["leaf", "teal", "gold", "nook-teal", "nook-yellow", "nook-pink"],
    },
  },
  args: { onClick: fn() },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Dot tone: cream pill + leading marker dot (the original example-chip look). */
export const DotTone: Story = {
  name: "Dot tone",
  args: { tone: "teal", children: "らき☆すた" },
};

/** All three dot tones side by side. */
export const AllDotTones: Story = {
  name: "All dot tones",
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Chip {...args} tone="leaf">
        leaf
      </Chip>
      <Chip {...args} tone="teal">
        teal
      </Chip>
      <Chip {...args} tone="gold">
        gold
      </Chip>
    </div>
  ),
};

/** NookPhone pastel tile (filled, no dot, game-press 3D shadow) — the homepage look. */
export const PastelTile: Story = {
  name: "Pastel tile",
  args: { tone: "nook-teal", children: "君の名は。" },
};

/** The three pastel tiles the hero cycles across its example chips. */
export const HeroExampleChips: Story = {
  name: "Hero example chips",
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2.5">
      <Chip {...args} tone="nook-teal">
        Your Name
      </Chip>
      <Chip {...args} tone="nook-yellow">
        Euphonium
      </Chip>
      <Chip {...args} tone="nook-pink">
        Weathering with You
      </Chip>
    </div>
  ),
};
