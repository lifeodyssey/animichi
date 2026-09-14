import type { Locale } from "../../i18n/locales";

const copy = {
  zh: { photoUnavailable: "暂无场景图片", title: "所选地点", back: "返回浏览", places: "{count} 个地点", viewpoints: "{count} 个取景位置", frames: "{count} 张图片", removePlace: "移除地点", removeViewpoint: "移除取景位置", undo: "撤销", removed: "已移除 {name}", removedViewpoint: "已移除取景位置：{name}", empty: "还没有选中的地点", browse: "继续浏览", expand: "展开取景位置", collapse: "收起取景位置" },
  en: { photoUnavailable: "Photo unavailable", title: "Selected places", back: "Back to browsing", places: "{count} places", viewpoints: "{count} viewpoints", frames: "{count} photos", removePlace: "Remove place", removeViewpoint: "Remove viewpoint", undo: "Undo", removed: "Removed {name}", removedViewpoint: "Removed viewpoint: {name}", empty: "No places selected yet", browse: "Keep browsing", expand: "Show viewpoints", collapse: "Hide viewpoints" },
  ja: { photoUnavailable: "画像なし", title: "選んだ場所", back: "場所探しに戻る", places: "{count}か所", viewpoints: "{count}か所の撮影位置", frames: "写真{count}枚", removePlace: "場所を外す", removeViewpoint: "撮影位置を外す", undo: "元に戻す", removed: "{name}を外しました", removedViewpoint: "撮影位置を外しました：{name}", empty: "まだ場所を選んでいません", browse: "場所探しを続ける", expand: "撮影位置を開く", collapse: "撮影位置を閉じる" },
};

export const selectedPlacesCopy = (locale: Locale) => copy[locale];
type CountKind = "places" | "viewpoints" | "frames";
const singular = { places: "1 place", viewpoints: "1 viewpoint", frames: "1 photo" };

export function selectedPlacesCount(locale: Locale, kind: CountKind, count: number): string {
  if (locale === "en" && count === 1) return singular[kind];
  return copy[locale][kind].replace("{count}", new Intl.NumberFormat(locale).format(count));
}
