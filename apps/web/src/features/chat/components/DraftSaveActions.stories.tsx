import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { DraftSavePreview } from "../../../../.storybook/chat-cards/DraftSavePreview";
import { itineraryDraftFixture } from "../../../../.storybook/chat-cards/itinerary-draft-fixtures";
import { manyItineraryFixture } from "../../../../.storybook/chat-cards/many-itinerary-fixtures";
import { chatDictFor } from "../i18n";

const meta = {
  title: "Chat/Planning/DraftSaveActions", component: DraftSavePreview,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "Save feedback stays below the complete itinerary. State is controlled and tied to the displayed draft version. Saving locks repeat writes, success exposes a saved-id callback, retryable failures can retry, permanent failures cannot, and unresolved auth never opens login. Saving is an explicit UI fixture, not a real persistence outcome: clicking save enters waiting, and the Saved story supplies a success fixture. Login reuses LoginModal; Storybook's form boundary prevents email sends. No Chat page, saved-page navigation or persistence integration is included." } } },
  globals: { locale: "zh" }, args: { draft: itineraryDraftFixture("zh"), dict: chatDictFor("zh"), status: "idle", onSave: fn(), onAdjust: fn(), onLogin: fn(), onView: fn() },
  argTypes: { dict: { control: false }, status: { control: "select", options: ["idle", "checking", "login-required", "saving", "saved", "retryable", "permanent"] } },
  render: (args) => <DraftSavePreview key={`${args.draft.id}:${args.dict.locale}:${args.status}`} {...args} />,
} satisfies Meta<typeof DraftSavePreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const LoginRequired: Story = { args: { status: "login-required" } };
export const LoginDialog: Story = { ...LoginRequired, play: async ({ canvasElement }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: "登录并保存" })); } };
export const Saving: Story = { args: { status: "saving" } };
export const Saved: Story = { args: { status: "saved" } };
export const RetryableFailure: Story = { args: { status: "retryable" } };
export const PermanentFailure: Story = { args: { status: "permanent" } };
export const CheckingLogin: Story = { args: { status: "checking" } };
export const Narrow: Story = { ...Saved, parameters: { chatViewport: "component-narrow" } };
export const ManyPlaces: Story = { ...Saved, args: { ...Saved.args, draft: manyItineraryFixture("zh") } };
export const English: Story = { ...Narrow, globals: { locale: "en" }, args: { ...Narrow.args, draft: itineraryDraftFixture("en") } };
export const Japanese: Story = { ...Narrow, globals: { locale: "ja" }, args: { ...Narrow.args, draft: itineraryDraftFixture("ja") } };
