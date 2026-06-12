import type { Meta, StoryObj } from "@storybook/react";
import ShowcaseCard from "./ShowcaseCard";

const meta = {
  title: "Landing/Hero/Showcase Card",
  component: ShowcaseCard,
  parameters: {
    layout: "centered",
    // Design tab: the tilted anime|real polaroid + lounging fox, from the live build.
    design: { type: "image", url: "/design-targets/landing-hero-scene-card.png" },
  },
  // Sit the card on the page GROUND (#f8f8f0) so the cream frame reads as the
  // floating surface layer — the three-layer depth the design system depends on.
  decorators: [
    (Story) => (
      <div style={{ background: "var(--animal-bg-color)", width: 760, padding: "84px 40px 56px" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ShowcaseCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const PHOTOS = {
  anime: { src: "/images/landing/suga-shrine-anime-source.webp", alt: "Anime" },
  real: { src: "/images/landing/suga-shrine-reality-perspective-v2.webp", alt: "Real" },
} as const;

/** Default: fox perched on the dipping top-right corner. */
export const Default: Story = {
  args: { anime: PHOTOS.anime, real: PHOTOS.real },
};

/** Frame only — the reusable anime|real comparison without the mascot. */
export const WithoutFox: Story = {
  name: "Without fox",
  args: { ...Default.args, showFox: false },
};
