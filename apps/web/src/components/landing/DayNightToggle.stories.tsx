import type { Meta, StoryObj } from "@storybook/react-vite";
import { DayNightToggle } from "./DayNightToggle";

const meta = { title: "Landing/Day Night Toggle", component: DayNightToggle } satisfies Meta<typeof DayNightToggle>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
