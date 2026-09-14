import type { Locale } from "../../i18n/locales";

const copy = {
  zh: { frames: "{count} 张", previous: "上一张", next: "下一张", noImage: "暂无场景图片" },
  en: { frames: "{count} photos", previous: "Previous photo", next: "Next photo", noImage: "No scene photo available" },
  ja: { frames: "{count}枚", previous: "前の写真", next: "次の写真", noImage: "画像はまだありません" },
};

export const sceneGroupCopy = (locale: Locale) => copy[locale];
export const sceneFrameCount = (locale: Locale, count: number): string => copy[locale].frames.replace("{count}", String(count));
