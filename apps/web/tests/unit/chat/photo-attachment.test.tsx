/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoSearchUpload } from "../../../src/features/chat/components/PhotoSearchUpload";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { photoAttachmentCopy } from "../../../src/features/chat/photo-attachment-copy";
import { MAX_PHOTO_BYTES, postPhotoSearch } from "../../../src/features/chat/photo-search";
import type { PhotoSearchOutcome } from "../../../src/features/chat/photo-search";
import { nativeDialogFixture } from "./dialog-fixture";

vi.mock("../../../src/features/chat/photo-search", async (original) => ({ ...await original<typeof import("../../../src/features/chat/photo-search")>(), postPhotoSearch: vi.fn() }));
const request = vi.mocked(postPhotoSearch), dict = chatDictFor("zh"), copy = photoAttachmentCopy("zh");
const context = { locale: "zh" as const }, QUOTA = { kind: "quota", guidance: "configure_vision_key" } as const;
class PreviewUrl extends URL {
  static override createObjectURL = vi.fn(() => "blob:photo-preview");
  static override revokeObjectURL = vi.fn();
}

nativeDialogFixture();
beforeEach(() => { request.mockReset(); PreviewUrl.createObjectURL.mockReset().mockReturnValue("blob:photo-preview"); PreviewUrl.revokeObjectURL.mockReset(); vi.stubGlobal("URL", PreviewUrl); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount() { return render(<PhotoSearchUpload dict={dict} baseUrl="/photos" context={context} />); }
function pick(file = new File(["image"], "scene.png", { type: "image/png" })) {
  fireEvent.change(screen.getByLabelText(dict.photo.upload, { selector: "input" }), { target: { files: [file] } });
  return file;
}
function preview() { return screen.getByRole("button", { name: `${copy.preview}: scene.png` }); }

describe("retained photo retry", () => {
  it("retries the identical file and keeps its preview through a failure", async () => {
    request.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(QUOTA);
    mount(); const file = pick();
    await screen.findByText(dict.photo.failed);
    expect(preview().querySelector("img")?.getAttribute("src")).toBe("blob:photo-preview");
    fireEvent.click(screen.getByRole("button", { name: dict.photo.retry }));
    await screen.findByText(dict.photo.quotaNoByok);
    expect(request).toHaveBeenNthCalledWith(1, "/photos", file, context);
    expect(request).toHaveBeenNthCalledWith(2, "/photos", file, context);
    expect(PreviewUrl.createObjectURL).toHaveBeenCalledTimes(1);
    expect(preview()).toBeTruthy();
  });

  it("locks repeated selection and allows viewing while recognition is pending", () => {
    request.mockReturnValue(new Promise(() => undefined));
    mount(); pick(); pick();
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(dict.photo.upload).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: copy.remove })).toBeNull();
    fireEvent.click(preview());
    expect(screen.getByRole("dialog", { name: "scene.png" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: dict.search.closePreview }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("attachment replacement and removal", () => {
  it("opens the picker on replace, retires the old image, and removes the attachment", async () => {
    request.mockRejectedValue(new Error("offline"));
    PreviewUrl.createObjectURL.mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
    mount(); pick(); await screen.findByText(dict.photo.failed);
    const input = screen.getByLabelText(dict.photo.upload, { selector: "input" }), choose = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: copy.replace }));
    expect(choose).toHaveBeenCalledOnce();
    pick(new File(["second"], "replacement.png", { type: "image/png" }));
    await screen.findByText(dict.photo.failed);
    expect(PreviewUrl.revokeObjectURL).toHaveBeenCalledWith("blob:first");
    expect(screen.queryByRole("button", { name: `${copy.preview}: scene.png` })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: copy.remove }));
    expect(screen.queryByRole("region", { name: copy.region })).toBeNull();
    expect(PreviewUrl.revokeObjectURL).toHaveBeenCalledWith("blob:second");
    expect(screen.getByRole("button", { name: dict.photo.upload })).toBeTruthy();
  });

  it("cleans up a pending image on unmount without showing its late result in a new mount", async () => {
    let finish: (value: PhotoSearchOutcome) => void = () => undefined;
    request.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const old = mount(); pick(); old.unmount(); mount();
    await act(async () => { finish(QUOTA); await Promise.resolve(); });
    expect(PreviewUrl.revokeObjectURL).toHaveBeenCalledWith("blob:photo-preview");
    expect(screen.queryByText(dict.photo.quotaNoByok)).toBeNull();
    expect(screen.queryByRole("region", { name: copy.region })).toBeNull();
  });
});

describe("invalid source files", () => {
  it.each([
    ["scene.gif", "image/gif", 1, dict.photo.unsupported],
    ["huge.png", "image/png", MAX_PHOTO_BYTES + 1, dict.photo.tooLarge],
  ])("does not read or retry %s", async (name, type, size, message) => {
    mount(); pick(new File([new Uint8Array(size)], name, { type }));
    await screen.findByText(message);
    expect(request).not.toHaveBeenCalled();
    expect(PreviewUrl.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: dict.photo.retry })).toBeNull();
    expect(screen.getByRole("button", { name: copy.replace })).toBeTruthy();
  });

  it("keeps actions available when the image cannot be displayed", async () => {
    request.mockRejectedValue(new Error("unreadable"));
    mount(); pick(); await screen.findByText(dict.photo.failed);
    fireEvent.error(screen.getByAltText(""));
    await waitFor(() => { expect(screen.queryByRole("button", { name: `${copy.preview}: scene.png` })).toBeNull(); });
    expect(screen.getByRole("button", { name: dict.photo.retry })).toBeTruthy();
    expect(screen.getByRole("button", { name: copy.replace })).toBeTruthy();
  });
});
