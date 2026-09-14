import type { Locale } from "../../i18n/locales";

const COPY = {
  zh: { region: "上传的图片", preview: "查看上传的图片", replace: "换一张", remove: "移除图片", received: "图片已处理", clarify: "还需要一点线索", formats: "JPEG、PNG 或 WebP · 最大 8 MB", unsupported: "暂不支持这种格式", tooLarge: "图片超过 8 MB", challenge: "需要重新验证", quota: "图片识别暂不可用" },
  ja: { region: "アップロードした画像", preview: "画像を大きく見る", replace: "別の画像", remove: "画像を削除", received: "画像の確認が完了", clarify: "もう少し手がかりがほしい", formats: "JPEG・PNG・WebP · 8 MB まで", unsupported: "この形式は未対応", tooLarge: "画像が 8 MB を超えています", challenge: "もう一度認証が必要です", quota: "画像検索はただいま利用できません" },
  en: { region: "Uploaded image", preview: "View uploaded image", replace: "Replace", remove: "Remove image", received: "Image processed", clarify: "A little more context", formats: "JPEG, PNG or WebP · Up to 8 MB", unsupported: "Unsupported format", tooLarge: "Image is over 8 MB", challenge: "Verification needed", quota: "Photo search is unavailable" },
} as const;

export function photoAttachmentCopy(locale: Locale) { return COPY[locale]; }
