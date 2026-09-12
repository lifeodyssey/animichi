import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { useLocale } from "../../../i18n/LocaleProvider";
import { chatDictFor } from "../i18n";
import { ChatAppBar } from "./ChatAppBar";
import { ChatHeader } from "./ChatHeader";
import { ChatInput } from "./ChatInput";
import { ChatShell } from "./ChatShell";
import { ChatSidebar } from "./ChatSidebar";
import { ColdStart } from "./ColdStart";

function PageComposition() {
  const dict = chatDictFor(useLocale());
  const send = fn();
  return <ChatShell appbar={<ChatAppBar dict={dict} status="anonymous" />} sidebar={<ChatSidebar dict={dict} status="anonymous" baseUrl="/storybook" activeSessionId={undefined} />} header={<ChatHeader dict={dict} />} notices={null} body={<ColdStart dict={dict} onChip={send} />} dock={null} composer={<div className="px-7 pb-6"><ChatInput dict={dict} disabled={false} onSend={send} /></div>} />;
}

const meta = { title: "Chat/Chrome/ChatShell", component: ChatShell, parameters: { layout: "fullscreen", chatViewport: "full" } } satisfies Meta<typeof ChatShell>;
export default meta;
type Story = StoryObj<typeof meta>;
export const RealPresentationComposition: Story = { render: () => <PageComposition />, args: { appbar: null, sidebar: null, header: null, notices: null, body: null, dock: null, composer: null } };
export const RegionSkeleton: Story = { args: { appbar: <div>Mobile bar</div>, sidebar: <aside>Sidebar</aside>, header: <header>Header</header>, notices: null, body: <p>Conversation body</p>, dock: null, composer: <footer>Composer</footer> } };
