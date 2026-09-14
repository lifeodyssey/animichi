import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { withChatErrors } from "../../../../../.storybook/chat-errors/decorators";
import { LimitBanner } from "./LimitBanner";

const meta = {
  title: "Chat/Errors/LimitBanner",
  component: LimitBanner,
  decorators: [withChatErrors],
  args: {
    block: "chat-budget-exhausted",
    message: "今日の無料プランの上限に達しました。",
    loginLabel: "ログインして続ける",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof LimitBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Alert: Story = {};
export const LoginModalOpen: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: args.loginLabel }));
  },
};
export const Status: Story = { args: { role: "status", id: "storybook-limit-banner" } };
export const WithSecondaryAction: Story = {
  args: { secondary: { label: "自分のAPIキーを使う", onClick: fn() } },
};
