import type { Meta, StoryObj } from "@storybook/react";
import ShowcaseCard from "./ShowcaseCard";

const meta = {
  title: "Landing/ShowcaseCard",
  component: ShowcaseCard,
  parameters: {
    layout: "centered",
    // Target design attached via @storybook/addon-designs — shows in the "Design" tab.
    // Cropped from the approved hero redraw (tilted anime|real card + lounging fox).
    design: {
      type: "image",
      url: "/design-targets/landing-hero-scene-card.png",
    },
  },
} satisfies Meta<typeof ShowcaseCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const renderInScene: Story["render"] = (args) => (
  <div style={{ background: "var(--animal-bg-color-content)", width: 720, padding: "72px 40px" }}>
    <ShowcaseCard {...args} />
  </div>
);

const baseArgs: Story["args"] = {
  anime: { src: "/images/landing/suga-shrine-anime-source.webp", alt: "Anime" },
  real: { src: "/images/landing/suga-shrine-reality-perspective-v2.webp", alt: "Real" },
};

export const English: Story = {
  args: baseArgs,
  render: renderInScene,
};

export const WithoutFox: Story = {
  name: "Without fox",
  args: { ...baseArgs, showFox: false },
  render: renderInScene,
};
