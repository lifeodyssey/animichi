import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Hero } from "./Hero";

const meta = { title: "Landing/Hero", component: Hero, parameters: { layout: "fullscreen" } } satisfies Meta<typeof Hero>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { onStart: fn() } };
