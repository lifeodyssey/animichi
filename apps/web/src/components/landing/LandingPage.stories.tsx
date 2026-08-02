import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { LandingPage } from "./LandingPage";

const meta = { title: "Landing/Page", component: LandingPage, parameters: { layout: "fullscreen" } } satisfies Meta<typeof LandingPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cta = canvas.getAllByRole("button", { name: /Start Exploring|巡礼をはじめる|开始巡礼/ }).at(0);
    if (!cta) throw new Error("Landing CTA story fixture is missing");
    await userEvent.click(cta);
    await expect(canvas.getByRole("dialog")).toBeVisible();
  },
};
