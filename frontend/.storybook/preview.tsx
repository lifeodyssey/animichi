import React from "react";
import type { Preview, Decorator } from "@storybook/react";
import { fn } from "storybook/test";
import { http, HttpResponse } from "msw";
import { setupWorker } from "msw/browser";
import { LocaleProvider } from "../lib/i18n-context";
import { PointSelectionContext } from "../contexts/PointSelectionContext";
import { SuggestContext } from "../contexts/SuggestContext";
import "../app/globals.css";

// --- MSW: mock API requests so components don't 404 in Storybook ---
const mswHandlers = [
  http.get("*/v1/bangumi/popular", () =>
    HttpResponse.json({
      bangumi: [
        { bangumi_id: "265059", title: "響け！ユーフォニアム", cover_url: "https://image.anitabi.cn/bangumi/51.jpg", points_count: 227 },
        { bangumi_id: "1424", title: "けいおん！", cover_url: "https://image.anitabi.cn/bangumi/1424.jpg", points_count: 59 },
        { bangumi_id: "317", title: "君の名は", cover_url: "https://image.anitabi.cn/bangumi/51.jpg", points_count: 91 },
      ],
    }),
  ),
  http.post("*/v1/runtime/stream", () => HttpResponse.json({ success: true })),
  http.post("*/v1/feedback", () => HttpResponse.json({ ok: true })),
  http.get("*/v1/conversations", () => HttpResponse.json({ conversations: [] })),
];

const worker = setupWorker(...mswHandlers);
void worker.start({ onUnhandledRequest: "bypass", quiet: true });

// next/font/google doesn't work in Storybook — load Google Fonts via CSS @import.
const fontStyle = document.createElement("style");
fontStyle.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;600;700&family=Noto+Serif+JP:wght@400;600;700&family=Noto+Sans+SC:wght@300;400;500;600&display=swap');
  :root {
    --font-noto-sans: "Noto Sans JP", system-ui, sans-serif;
    --font-noto-serif: "Noto Serif JP", Georgia, serif;
    --font-noto: "Noto Sans SC", system-ui, sans-serif;
    --font-sans: system-ui, sans-serif;
  }
`;
document.head.appendChild(fontStyle);

const withProviders: Decorator = (Story) => (
  <LocaleProvider>
    <PointSelectionContext.Provider
      value={{ selectedIds: new Set(), toggle: fn(), clear: fn() }}
    >
      <SuggestContext.Provider value={{ onSuggest: fn() }}>
        <Story />
      </SuggestContext.Provider>
    </PointSelectionContext.Provider>
  </LocaleProvider>
);

const preview: Preview = {
  parameters: {
    layout: "centered",
    backgrounds: { disable: true },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  decorators: [withProviders],
};

export default preview;
