import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { LoginModal } from "./LoginModal";

const meta = { title: "Auth/Login Modal", component: LoginModal, parameters: { layout: "fullscreen" } } satisfies Meta<typeof LoginModal>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = { args: { open: true, onClose: fn() } };
