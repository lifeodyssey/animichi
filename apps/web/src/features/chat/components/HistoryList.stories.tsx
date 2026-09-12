import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { chatDictFor } from "../i18n";
import { HistoryReplayPreview } from "../../../../.storybook/chat-chrome/HistoryReplayPreview";
import { brokenHistoryImages, historyReplayFixtures, incompleteHistoryFixtures } from "../../../../.storybook/chat-chrome/history-replay-fixtures";

const entries = [
  { role: "user", content: "宇治を一日で歩きたい" },
  { role: "assistant", content: "朝から回れる順番を考えるね。", intent: "route_plan" },
] as const;
const meta = {
  title: "Chat/History/HistoryList", component: HistoryReplayPreview,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "Static history replay using MessagePresentation, the existing picture gallery, and ItineraryDraftDocument. Rich blocks are explicit presentation fixtures, never reconstructed from text or intent. Missing blocks retain the other content. The owner supplies loading/error outcomes and the session id; changing the session resets local previews. Retry enters waiting only; Continue adjusting emits the visible draft id. No real session restoration, saved-state inference, Chat layout or backend changes are included." } } },
  globals: { locale: "zh" }, args: { entries: historyReplayFixtures("zh"), dict: chatDictFor("zh"), status: "success", sessionId: "history-preview", onRetry: fn(), onContinueDraft: fn() },
  argTypes: { dict: { control: false }, status: { control: "select", options: ["idle", "loading", "error", "success"] } },
  render: (args) => <HistoryReplayPreview key={`${args.dict.locale}:${args.status ?? "legacy"}:${args.sessionId ?? "none"}`} {...args} />,
} satisfies Meta<typeof HistoryReplayPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const Loading: Story = { args: { entries: [], status: "loading" } };
export const Failed: Story = { args: { entries: [], status: "error" } };
export const PartialContent: Story = { args: { entries: incompleteHistoryFixtures("zh", "draft") } };
export const MissingScenes: Story = { args: { entries: incompleteHistoryFixtures("zh", "scenes") } };
export const BrokenImages: Story = { args: { entries: brokenHistoryImages("zh") } };
export const Refreshing: Story = { args: { status: "loading" } };
export const RefreshFailed: Story = { args: { status: "error" } };
export const TextOnlyReplay: Story = { globals: { locale: "ja" }, args: { entries } };
export const Empty: Story = { args: { entries: [] } };
export const Inactive: Story = { args: { status: "idle" } };
export const Narrow: Story = { parameters: { chatViewport: "component-narrow" } };
export const English: Story = { ...Narrow, globals: { locale: "en" }, args: { entries: historyReplayFixtures("en") } };
export const Japanese: Story = { ...Narrow, globals: { locale: "ja" }, args: { entries: historyReplayFixtures("ja") } };
