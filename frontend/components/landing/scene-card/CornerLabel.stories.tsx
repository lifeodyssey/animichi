// no-design-target: atomic scene-card sub-label; in isolation it has no standalone
// blueprint crop — it is reviewed in context under Landing/Hero/SceneCard.
import type { Meta, StoryObj } from "@storybook/react";
import CornerLabel from "./CornerLabel";

const meta = {
  title: "Landing/Hero/SceneCard/CornerLabel",
  component: CornerLabel,
  parameters: { layout: "centered" },
} satisfies Meta<typeof CornerLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A faux photo region so the absolutely-positioned label has a frame to float over. */
function Photo({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-[140px] w-[340px] overflow-hidden rounded-[18px] bg-muted">
      {children}
    </div>
  );
}

export const AnimeLeft: Story = {
  args: { side: "left", tone: "anime", text: "Anime" },
  render: (args) => (
    <Photo>
      <CornerLabel {...args} />
    </Photo>
  ),
};

export const RealRight: Story = {
  args: { side: "right", tone: "real", text: "Real" },
  render: (args) => (
    <Photo>
      <CornerLabel {...args} />
    </Photo>
  ),
};

export const BothCorners: Story = {
  name: "Both corners (anime ↔ real)",
  args: { side: "left", tone: "anime", text: "Anime" },
  render: () => (
    <Photo>
      <CornerLabel side="left" tone="anime" text="Anime" />
      <CornerLabel side="right" tone="real" text="Real" />
    </Photo>
  ),
};
