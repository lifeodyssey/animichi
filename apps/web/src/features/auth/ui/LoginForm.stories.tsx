import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { LoginForm } from "./LoginForm";

const meta = { title: "Auth/Login Form", component: LoginForm, tags: ["autodocs"] } satisfies Meta<typeof LoginForm>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { onSendCommitted: fn(), returnTarget: "/chat" } };
