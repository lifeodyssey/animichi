import type { Meta, StoryObj } from "@storybook/react-vite";
import { PrivacyPolicy } from "./PrivacyPolicy";

const meta = { title: "Legal/Privacy Policy", component: PrivacyPolicy, parameters: { layout: "fullscreen" }, tags: ["autodocs"] } satisfies Meta<typeof PrivacyPolicy>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
