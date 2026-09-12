import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { chatDictFor } from "../i18n";
import { withChatLocale } from "../../../../.storybook/chat-chrome/story-helpers";
import { DeparturePrompt } from "./DeparturePrompt";

const meta = { title: "Chat/Entry/DeparturePrompt", component: DeparturePrompt, decorators: [withChatLocale] } satisfies Meta<typeof DeparturePrompt>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Options: Story = { args: { dict: chatDictFor("ja"), onChip: fn(), onLocated: fn(), onManualLocation: fn() } };
export const Narrow: Story = { args: Options.args, parameters: { chatViewport: "narrow" }, globals: { viewport: { value: "375-812", isRotated: false } } };
