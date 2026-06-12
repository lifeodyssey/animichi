import type { Meta, StoryObj } from "@storybook/react";
import RouteTrail from "./RouteTrail";

const meta = {
  title: "Landing/Hero/Route Trail",
  component: RouteTrail,
  parameters: {
    layout: "fullscreen",
    // Design tab: the hero band — the trail has no standalone crop, but it is
    // visible in context (dashed line + pins) within the full hero blueprint.
    design: { type: "image", url: "/design-targets/landing-hero-section.png" },
    docs: {
      description: {
        component:
          "The hand-drawn journey doodle behind the hero: a dashed warm-brown line " +
          "with a teal departure pin, espresso waypoints, a loop-de-loop, and a gold " +
          "destination pin. Absolutely positioned (inset-0) and aria-hidden; hidden " +
          "below the lg breakpoint because its pin coordinates assume the desktop layout.",
      },
    },
  },
} satisfies Meta<typeof RouteTrail>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * RouteTrail fills its positioned parent (inset-0). The wrapper gives it a
 * hero-sized stage and the page ground so the warm-brown dashes read correctly.
 * It only renders at lg+; view this story at a wide viewport.
 */
export const Default: Story = {
  render: () => (
    <div className="relative h-[600px] w-full bg-background">
      <RouteTrail />
    </div>
  ),
};
