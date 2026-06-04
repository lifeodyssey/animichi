import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import HeroIntro from "./HeroIntro";

const meta = {
  title: "Landing/Hero/Intro",
  component: HeroIntro,
  parameters: {
    layout: "fullscreen",
    // Target design attached via @storybook/addon-designs — shows in the "Design" tab.
    design: {
      type: "image",
      url: "/design-targets/target-parchment.png",
    },
    docs: {
      description: {
        component:
          "Left hero column — torii eyebrow, large serif headline, lead, combined search with a pumpkin Start Exploring CTA, and example chips. No card framing.",
      },
    },
  },
} satisfies Meta<typeof HeroIntro>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { onSearch: fn(), onChip: fn() },
  render: (args) => (
    <div className="min-h-[560px] bg-[var(--animal-bg-color-content)] px-12 py-14">
      <div className="max-w-[640px]">
        <HeroIntro {...args} />
      </div>
    </div>
  ),
};
