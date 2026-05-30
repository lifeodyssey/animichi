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
      options: ["welcome", "ai-navigator", "compare", "traveler", "icon-mark"],
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

export const AiNavigator: Story = {
  args: { pose: "ai-navigator", size: "md", surface: "loading" },
};

export const Compare: Story = {
  args: { pose: "compare", size: "md", surface: "welcome" },
};

export const Traveler: Story = {
  args: { pose: "traveler", size: "md", surface: "empty" },
};

export const IconMark: Story = {
  args: { pose: "icon-mark", size: "sm", surface: "welcome" },
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
  args: { pose: "ai-navigator", size: "md", surface: "loading" },
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
