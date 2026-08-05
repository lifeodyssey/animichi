import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type { ReactElement } from "react";
import { ComingSoonPopup, type ComingSoonPopupProps } from "./ComingSoonPopup";

/** Pin navigator.languages so the LocaleProvider decorator detects the story's locale. */
function withLanguages(langs: string[]): (props: ComingSoonPopupProps) => ReactElement {
  return (props) => {
    Object.defineProperty(navigator, "languages", { value: langs, configurable: true });
    return <ComingSoonPopup {...props} />;
  };
}

const meta = { title: "Landing/ComingSoonPopup", component: ComingSoonPopup, parameters: { layout: "centered" } } satisfies Meta<typeof ComingSoonPopup>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Japanese: Story = {
  args: { open: true, onClose: fn() },
  render: withLanguages(["ja-JP"]),
};

export const Chinese: Story = {
  args: { open: true, onClose: fn() },
  render: withLanguages(["zh-CN"]),
};

export const English: Story = {
  args: { open: true, onClose: fn() },
  render: withLanguages(["en-US"]),
};
