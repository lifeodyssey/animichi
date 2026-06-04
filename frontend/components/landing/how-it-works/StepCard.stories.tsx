// no-design-target: design-system primitive / sub-component below the hero blueprint granularity
import type { Meta, StoryObj } from "@storybook/react";
import { Search } from "lucide-react";
import StepCard from "./StepCard";
import MiniSearch from "./MiniSearch";

const meta = {
  title: "Landing/HowItWorks/StepCard",
  component: StepCard,
  parameters: { layout: "centered" },
} satisfies Meta<typeof StepCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    index: 0,
    addRevealRef: () => {},
    step: {
      icon: Search,
      tint: "var(--color-primary)",
      title: "作品から探す",
      desc: "好きなアニメのタイトルを入れるだけで、聖地が見つかります。",
      preview: <MiniSearch />,
    },
  },
  render: (args) => (
    <ol className="w-[260px]">
      <StepCard {...args} />
    </ol>
  ),
};
