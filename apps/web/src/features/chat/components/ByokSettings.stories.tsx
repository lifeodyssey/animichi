import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { clearByokConfig, saveByokConfig, setByokVisionSupported } from "../../../lib/byok/byok-storage";
import { chatDictFor } from "../i18n";
import { ByokSettings } from "./ByokSettings";

const probe = () => Promise.resolve({ kind: "ok", vision: true, definitive: true } as const);

function emptyFixture(): () => void {
  clearByokConfig();
  return clearByokConfig;
}

function savedFixture(): () => void {
  saveByokConfig({ provider: "anthropic", apiKey: "sk-storybook-redacted", model: "claude-sonnet-4-5" });
  setByokVisionSupported(true);
  return clearByokConfig;
}

const meta = {
  title: "Chat/Account/ByokSettings",
  component: ByokSettings,
  args: { dict: chatDictFor("ja"), auth: "pending", baseUrl: "http://storybook.invalid" },
  tags: ["autodocs"],
} satisfies Meta<typeof ByokSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SessionPending: Story = {};
export const AnonymousTeaser: Story = { args: { auth: "anonymous" } };
export const AuthenticatedEmpty: Story = {
  args: { auth: "authenticated", probe },
  beforeEach: emptyFixture,
};
export const AuthenticatedValidationError: Story = {
  args: { auth: "authenticated", probe },
  beforeEach: emptyFixture,
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: args.dict.byok.save }));
  },
};
export const AuthenticatedSaved: Story = {
  args: { auth: "authenticated", probe },
  beforeEach: savedFixture,
};
export const NarrowAnonymous: Story = {
  globals: { locale: "en", viewport: { value: "375-812", isRotated: false } },
  args: { auth: "anonymous", dict: chatDictFor("en") },
  parameters: { chatViewport: "narrow" },
};
