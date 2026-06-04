import type { Meta, StoryObj } from "@storybook/react";
import SceneFrameCard from "./SceneFrameCard";

const meta = {
  title: "Landing/Hero/SceneCard/Frame",
  component: SceneFrameCard,
  parameters: {
    layout: "centered",
    // Blueprint: the approved hero composite. This story reviews the photo frame on
    // its own; the guide fox visible in the target belongs to HeroSceneCard's
    // composition (see Landing/Hero/SceneCard), not to this mascot-free frame.
    design: {
      type: "image",
      url: "/design-targets/hero-scene-card.png",
    },
  },
} satisfies Meta<typeof SceneFrameCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Standalone: Story = {
  args: {
    animeSrc: "/images/landing/suga-shrine-anime-source.webp",
    realSrc: "/images/landing/suga-shrine-reality-perspective-v2.webp",
    animeLabel: "Anime",
    realLabel: "Real",
    locationName: "Suga Shrine Steps",
    locationArea: "Shinjuku, Tokyo",
    routePreviewLabel: "Route preview",
  },
  render: (args) => (
    <div style={{ background: "var(--animal-bg-color-content)", width: 640, padding: "72px 40px" }}>
      <SceneFrameCard {...args} />
    </div>
  ),
};
