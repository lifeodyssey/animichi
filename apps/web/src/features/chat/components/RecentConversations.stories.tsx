import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { RecentConversationsPreview } from "../../../../.storybook/chat-chrome/RecentConversationsPreview";
import { manyConversationFixtures, recentConversationFixtures } from "../../../../.storybook/chat-chrome/recent-conversations-fixtures";
import { chatDictFor } from "../i18n";

const meta = {
  title: "Chat/History/RecentConversations", component: RecentConversationsPreview,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "Standalone recent-conversation list using the existing id/title/subtitle shape. The subtitle is the first query, not a saved-draft status. Examples are authored UI fixtures; there are no invented dates or saved badges. Selecting a row only changes the preview highlight; retry only enters waiting. Native links preserve the session id and modified-click behavior. The Chat sidebar, session restore and request retry remain unwired." } } },
  globals: { locale: "zh" }, args: { dict: chatDictFor("zh"), conversations: recentConversationFixtures("zh"), status: "success", activeSessionId: "recent-example-1", onOpen: fn(), onRetry: fn() },
  argTypes: { dict: { control: false }, status: { control: "select", options: ["idle", "loading", "error", "success"] } },
  render: (args) => <RecentConversationsPreview key={`${args.dict.locale}:${args.status}:${args.activeSessionId ?? "none"}`} {...args} />,
} satisfies Meta<typeof RecentConversationsPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const Loading: Story = { args: { status: "loading", conversations: [] } };
export const Empty: Story = { args: { conversations: [] } };
export const Failed: Story = { args: { status: "error", conversations: [] } };
export const RefreshFailed: Story = { args: { status: "error" } };
export const Refreshing: Story = { args: { status: "loading" } };
export const Inactive: Story = { args: { status: "idle" } };
export const Narrow: Story = { parameters: { chatViewport: "component-narrow" } };
export const ManyConversations: Story = { args: { conversations: manyConversationFixtures("zh"), activeSessionId: "many-example-0" } };
export const LongTitles: Story = { args: { conversations: [{ id: "long-title", title: "想把《你的名字。》里东京的取景地放在同一个周末，从新宿出发再去四谷和参宫桥，慢慢看图、慢慢走", subtitle: "只有一个下午，想先看看分布，再决定具体去哪里。" }, { id: "long-word", title: "averylongunbrokenconversationtitleaboutanimepilgrimagelocationsintokyo", subtitle: "Original conversation title" }], activeSessionId: "long-title" } };
export const MissingTitles: Story = { args: { conversations: [{ id: "first-query", title: "", subtitle: "周日下午想去宇治散步" }, { id: "untitled", title: "  ", subtitle: "  " }, { id: "repeated", title: "镰仓看海", subtitle: "镰仓看海" }], activeSessionId: "first-query" } };
export const English: Story = { ...Narrow, globals: { locale: "en" }, args: { conversations: recentConversationFixtures("en") } };
export const Japanese: Story = { ...Narrow, globals: { locale: "ja" }, args: { conversations: recentConversationFixtures("ja") } };
