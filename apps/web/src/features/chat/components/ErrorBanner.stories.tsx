import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { chatDictFor } from "../i18n";
import { ErrorBanner } from "./ErrorBanner";

const meta = {
  title: "Chat/Errors/ErrorBanner",
  component: ErrorBanner,
  args: { dict: chatDictFor("ja"), onRetry: fn() },
  tags: ["autodocs"],
} satisfies Meta<typeof ErrorBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unreachable: Story = {};

export const HistoryFailure: Story = {
  args: { message: chatDictFor("ja").historyError },
};

export const LongEnglishMessage: Story = {
  globals: { locale: "en", viewport: { value: "375-812", isRotated: false } },
  args: {
    dict: chatDictFor("en"),
    message: "We could not restore the earlier conversation. Your current draft is still here, so you can try again safely.",
  },
  parameters: { chatViewport: "narrow" },
};
