import type { Meta, StoryObj } from "@storybook/react";
import LoginForm from "./LoginForm";

const meta = {
  title: "Auth/LoginForm",
  component: LoginForm,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-[400px] rounded-xl bg-card p-8 shadow-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LoginForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    redirect: "/chat",
  },
};

export const WithInitialError: Story = {
  args: {
    redirect: "/chat",
    initialError: "セッションの有効期限が切れました。もう一度ログインしてください。",
  },
};

export const WithExpiredLinkError: Story = {
  args: {
    redirect: "/chat",
    initialError: "このリンクはすでに使用されているか、有効期限が切れています。",
  },
};
