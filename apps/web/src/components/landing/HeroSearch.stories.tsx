import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { HeroSearch } from "./HeroSearch";

const meta = { title: "Landing/Hero Search", component: HeroSearch } satisfies Meta<typeof HeroSearch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { onSubmit: fn() } };
