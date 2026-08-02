import type { Meta, StoryObj } from "@storybook/react-vite";
import { ComparisonSlider } from "./ComparisonSlider";

const meta = { title: "Landing/Comparison Slider", component: ComparisonSlider, parameters: { layout: "centered" } } satisfies Meta<typeof ComparisonSlider>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
