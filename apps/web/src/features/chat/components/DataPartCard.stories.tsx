import type { Meta, StoryObj } from "@storybook/react-vite";
import { clarifyPart, fullRoutePart } from "../../../../.storybook/chat-cards/fixtures";
import { chatDictFor } from "../i18n";
import { DataPartCard } from "./DataPartCard";

const meta = {
  title: "Chat/Cards/DataPartCard",
  component: DataPartCard,
  args: { data: clarifyPart, dict: chatDictFor("ja") },
} satisfies Meta<typeof DataPartCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SettledIntent: Story = {};
/** The full route card inside its shared Animal Island result surface. */
export const SettledRoute: Story = { args: { data: fullRoutePart } };
export const Superseded: Story = { args: { superseded: true } };
export const SupersededRoute: Story = {
  args: {
    superseded: true,
    data: {
      intent: "plan_route",
      success: true,
      message: "宇治の前のルート案です。",
      data: { itinerary: { point_count: 2, ordered_points: [{ id: "old-1", name: "宇治橋" }, { id: "old-2", name: "京阪宇治駅" }] } },
    },
  },
};
export const InvalidEnvelope: Story = { args: { data: { intent: "not-a-real-intent" } } };
export const FailedEnvelope: Story = {
  args: { data: { intent: "error", success: false, status: "error", errors: [{ code: "UPSTREAM_FAILURE", message: "fixture" }] } },
};
export const English: Story = { args: { dict: chatDictFor("en") }, globals: { locale: "en" } };
export const Chinese: Story = { args: { dict: chatDictFor("zh") }, globals: { locale: "zh" } };
