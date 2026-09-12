import type { Decorator, Preview } from "@storybook/react";
import { ChatReviewSurface } from "./chat-chrome/ChatReviewSurface";
import { StoryProviders } from "./chat-chrome/StoryProviders";
import { chatDictFor } from "../src/features/chat/i18n";
import { isLocale } from "../src/i18n/locales";
import "../src/styles/globals.css";

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined;
}

function titleOf(context: unknown): string {
  const title = fieldOf(context, "title");
  return typeof title === "string" ? title : "";
}

function argsOf(context: unknown): Record<string, unknown> {
  const args = fieldOf(context, "args");
  return typeof args === "object" && args !== null ? args as Record<string, unknown> : {};
}

function localeOf(context: unknown) {
  const locale = fieldOf(fieldOf(context, "globals"), "locale");
  return typeof locale === "string" && isLocale(locale) ? locale : "ja";
}

const withChatDict: Decorator = (Story, context) => {
  const args = argsOf(context);
  if (!titleOf(context).startsWith("Chat/") || !("dict" in args)) return <Story />;
  return <Story args={{ ...args, dict: chatDictFor(localeOf(context)) }} />;
};

const withProviders: Decorator = (Story, context) => (
  <StoryProviders locale={fieldOf(fieldOf(context, "globals"), "locale")}>
    <ChatReviewSurface title={titleOf(context)} viewport={fieldOf(fieldOf(context, "parameters"), "chatViewport")}><Story /></ChatReviewSurface>
  </StoryProviders>
);

const preview: Preview = {
  decorators: [withProviders, withChatDict],
  globalTypes: {
    locale: {
      description: "UI locale",
      defaultValue: "ja",
      toolbar: { icon: "globe", items: [{ value: "ja", title: "日本語" }, { value: "zh", title: "中文" }, { value: "en", title: "English" }] },
    },
  },
  initialGlobals: { locale: "ja" },
  parameters: {
    layout: "padded",
    docs: { page: null },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
};

export default preview;
