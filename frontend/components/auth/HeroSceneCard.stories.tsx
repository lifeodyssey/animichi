import type { Meta, StoryObj } from "@storybook/react";
import HeroSceneCard from "./HeroSceneCard";

const meta = {
  title: "Landing/Hero/SceneCard",
  component: HeroSceneCard,
  parameters: {
    layout: "centered",
    // Target design attached via @storybook/addon-designs — shows in the "Design" tab.
    // This is the approved hero composite (tilted before/after card + lounging fox).
    design: {
      type: "image",
      url: "/design-targets/hero-scene-card.png",
    },
  },
} satisfies Meta<typeof HeroSceneCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const English: Story = {
  args: {
    animeSrc: "/images/landing/suga-shrine-anime-source.webp",
    realSrc: "/images/landing/suga-shrine-reality-perspective-v2.webp",
    animeLabel: "Anime",
    realLabel: "Real",
    locationName: "Suga Shrine Steps",
    locationArea: "Shinjuku, Tokyo",
    routePreviewLabel: "Route preview",
    showStamp: false,
  },
  render: (args) => (
    <div style={{ background: "var(--animal-bg-color-content)", width: 640, padding: "72px 40px" }}>
      <HeroSceneCard {...args} />
    </div>
  ),
};

export const WithoutFox: Story = {
  name: "Without fox",
  args: { ...English.args, showFox: false },
  render: English.render,
};
