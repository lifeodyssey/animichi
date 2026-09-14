import type { Meta, StoryObj } from "@storybook/react-vite";
import { PhotoAttachmentPreview, PHOTO_PREVIEW_WIDTH, PHOTO_SOURCE, PHOTO_STATES } from "../../../../.storybook/chat-chrome/PhotoAttachmentPreview";
import { chatDictFor } from "../i18n";
import { PhotoSearchUpload } from "./PhotoSearchUpload";

const meta = {
  title: "Chat/Composer/PhotoSearchUpload", component: PhotoAttachmentPreview,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "Retained source-image attachment using Animal Island buttons and Tailwind. Recognition, clarification, invalid-file, challenge and quota outcomes are explicit UI fixtures. Source image is an existing repository scene asset; it was not recognized by a service in this preview. The shared result cards remain unchanged. File selection and preview are real, but Storybook isolates photo requests: uploading or retrying stays pending without consuming quota. No Chat page or backend changes." } } },
  globals: { locale: "zh" }, args: { dict: chatDictFor("zh"), state: PHOTO_STATES.uploading, src: PHOTO_SOURCE },
  argTypes: { dict: { control: false }, state: { control: false } },
  render: (args) => <PhotoAttachmentPreview key={`${args.dict.locale}:${args.state.kind}:${args.name ?? ""}:${args.src ?? ""}`} {...args} />,
} satisfies Meta<typeof PhotoAttachmentPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const TrayTrigger: Story = { render: ({ dict }) => <div className={PHOTO_PREVIEW_WIDTH}><PhotoSearchUpload dict={dict} baseUrl="/storybook" context={{ locale: dict.locale }} /></div> };
export const CameraTrigger: Story = { render: ({ dict }) => <div className={PHOTO_PREVIEW_WIDTH}><PhotoSearchUpload dict={dict} baseUrl="/storybook" context={{ locale: dict.locale }} iconTrigger /></div> };
export const Recognizing: Story = {};
export const Recognized: Story = { args: { state: PHOTO_STATES.done } };
export const NeedsContext: Story = { args: { state: PHOTO_STATES.clarify } };
export const FailedRetry: Story = { args: { state: PHOTO_STATES.failed } };
export const Unsupported: Story = { args: { state: PHOTO_STATES.unsupported, name: "scene.gif", src: undefined } };
export const TooLarge: Story = { args: { state: PHOTO_STATES.tooLarge, name: "scene-original.png", src: undefined } };
export const Challenge: Story = { args: { state: PHOTO_STATES.challenge } };
export const Quota: Story = { args: { state: PHOTO_STATES.quota } };
export const VisionUnsupported: Story = { args: { state: PHOTO_STATES.vision } };
export const UnreadableImage: Story = { args: { state: PHOTO_STATES.failed, src: "/images/does-not-exist.webp" } };
export const Narrow: Story = { ...FailedRetry, parameters: { chatViewport: "component-narrow" }, args: { ...FailedRetry.args, name: "这是一个保留原始文件名的很长很长的动画截图-scene-original-01.webp" } };
export const English: Story = { ...Narrow, globals: { locale: "en" }, args: { ...FailedRetry.args, name: "a-very-long-original-anime-screenshot-filename.webp" } };
export const Japanese: Story = { ...Narrow, globals: { locale: "ja" }, args: { ...FailedRetry.args, name: "アニメのスクリーンショット-original-scene.webp" } };
