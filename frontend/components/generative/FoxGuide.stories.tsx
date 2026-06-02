import type { Meta, StoryObj } from "@storybook/react";
import FoxGuide from "./FoxGuide";

const meta = {
  title: "Generative/FoxGuide",
  component: FoxGuide,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Fox mascot v2 — policy-enforcing placement component. Only allowed on emotional surfaces (welcome, empty, error, permission, loading). High-task pages are excluded from the FoxSurface union, making misuse a compile error.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    pose: {
      control: "select",
      options: ["welcome", "guide", "traveler", "thinking", "cheer", "curious", "oops"],
    },
    size: { control: "select", options: ["sm", "md", "lg"] },
    surface: {
      control: "select",
      options: ["welcome", "empty", "error", "permission", "loading"],
    },
  },
} satisfies Meta<typeof FoxGuide>;

export default meta;
type Story = StoryObj<typeof meta>;

// ---------------------------------------------------------------------------
// Core poses
// ---------------------------------------------------------------------------

export const Welcome: Story = {
  args: { pose: "welcome", size: "md", surface: "welcome" },
};

export const Guide: Story = {
  args: { pose: "guide", size: "md", surface: "welcome" },
};

export const Traveler: Story = {
  args: { pose: "traveler", size: "md", surface: "empty" },
};

export const Thinking: Story = {
  args: { pose: "thinking", size: "md", surface: "loading" },
};

export const Cheer: Story = {
  args: { pose: "cheer", size: "md", surface: "welcome" },
};

export const Curious: Story = {
  args: { pose: "curious", size: "md", surface: "empty" },
};

export const Oops: Story = {
  args: { pose: "oops", size: "md", surface: "error" },
};

// ---------------------------------------------------------------------------
// Size variants
// ---------------------------------------------------------------------------

export const SizeSmall: Story = {
  args: { pose: "welcome", size: "sm", surface: "welcome" },
  name: "Size — sm",
};

export const SizeMedium: Story = {
  args: { pose: "welcome", size: "md", surface: "welcome" },
  name: "Size — md",
};

export const SizeLarge: Story = {
  args: { pose: "welcome", size: "lg", surface: "welcome" },
  name: "Size — lg",
};

// ---------------------------------------------------------------------------
// Reduced motion — annotated; actual behaviour driven by OS media query
// ---------------------------------------------------------------------------

export const ReducedMotionNote: Story = {
  args: { pose: "thinking", size: "md", surface: "loading" },
  name: "Reduced motion (OS setting controls animation)",
  parameters: {
    docs: {
      description: {
        story:
          "When the OS reports `prefers-reduced-motion: reduce`, the `fox-idle` animation class is suppressed. Toggle your OS accessibility setting to verify in the browser.",
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Cutout review — every pose over cream / photo / dark backgrounds.
// Reveals white halos or over-cut edges that a single background can hide.
// ---------------------------------------------------------------------------

const POSES = [
  "welcome",
  "guide",
  "traveler",
  "thinking",
  "cheer",
  "curious",
  "oops",
] as const;

const BACKDROPS: { label: string; style: React.CSSProperties }[] = [
  { label: "cream card", style: { background: "#faf8f3" } },
  { label: "dark teal", style: { background: "#197873" } },
  {
    label: "photo",
    style: {
      backgroundImage:
        "url(/images/landing/suga-shrine-reality-perspective-v2.webp)",
      backgroundSize: "cover",
      backgroundPosition: "center",
    },
  },
];

export const CutoutReview: Story = {
  name: "Cutout review (all poses × backgrounds)",
  args: { pose: "welcome", size: "lg", surface: "welcome" },
  parameters: { layout: "fullscreen" },
  render: () => (
    <div style={{ fontFamily: "var(--app-font-body, sans-serif)" }}>
      {BACKDROPS.map((bd) => (
        <div key={bd.label} style={bd.style} className="px-6 py-8">
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-fg/60">
            {bd.label}
          </p>
          <div className="flex flex-wrap items-end gap-8">
            {POSES.map((pose) => (
              <div
                key={pose}
                className="relative h-36 w-36 shrink-0"
                title={pose}
              >
                <FoxGuide pose={pose} size="lg" surface="welcome" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  ),
};
