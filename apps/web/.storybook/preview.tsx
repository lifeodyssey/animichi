import type { Decorator, Preview } from "@storybook/react";
import { LocaleProvider } from "../src/i18n/context";
import "../src/styles/globals.css";

const withLocale: Decorator = (Story) => <LocaleProvider><Story /></LocaleProvider>;

const preview: Preview = {
  decorators: [withLocale],
  parameters: {
    layout: "padded",
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
};

export default preview;
