import type { Decorator, Preview } from "@storybook/react";
import { useEffect } from "react";
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

function nameOf(context: unknown): string {
  const name = fieldOf(context, "name");
  return typeof name === "string" ? name : "";
}

/* Night review path: stories named Night* (the repo convention, e.g.
 * ClarifyCard's NightDetails) and any story with the `theme` toolbar set to
 * night get `data-theme="night"` on the iframe's <html> — exactly where the
 * app's theme bootstrap puts it — so the review surface and the canvas flip
 * with the card. A wrapper div proved order-fragile: the review surface
 * (withProviders) reads its ground var ABOVE any decorator's div. */
function isNight(context: unknown): boolean {
  if (fieldOf(fieldOf(context, "globals"), "theme") === "night") return true;
  return nameOf(context).startsWith("Night");
}

function applyNightTheme(night: boolean): () => void {
  if (!night) return () => undefined;
  const root = document.documentElement;
  const previous = root.getAttribute("data-theme");
  root.setAttribute("data-theme", "night");
  return () => { if (previous === null) root.removeAttribute("data-theme"); else root.setAttribute("data-theme", previous); };
}

const WithNightGround: Decorator = (Story, context) => {
  useEffect(() => applyNightTheme(isNight(context)), [context]);
  return <Story />;
};

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
  decorators: [WithNightGround, withProviders, withChatDict],
  globalTypes: {
    locale: {
      description: "UI locale",
      defaultValue: "ja",
      toolbar: { icon: "globe", items: [{ value: "ja", title: "日本語" }, { value: "zh", title: "中文" }, { value: "en", title: "English" }] },
    },
    theme: {
      description: "Day/night token theme",
      defaultValue: "day",
      toolbar: { icon: "mirror", items: [{ value: "day", title: "Day" }, { value: "night", title: "Night" }] },
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
