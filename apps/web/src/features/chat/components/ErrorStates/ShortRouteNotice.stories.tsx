import type { Meta, StoryObj } from "@storybook/react-vite";
import { withChatErrors } from "../../../../../.storybook/chat-errors/decorators";
import { chatDictFor } from "../../i18n";
import { ShortRouteNotice } from "./ShortRouteNotice";

const meta = {
  title: "Chat/Errors/ShortRouteNotice",
  component: ShortRouteNotice,
  args: { dict: chatDictFor("ja") },
  decorators: [withChatErrors],
  tags: ["autodocs"],
} satisfies Meta<typeof ShortRouteNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WidenSearch: Story = {};
export const English: Story = { globals: { locale: "en" }, args: { dict: chatDictFor("en") } };
