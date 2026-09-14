import type { Locale } from "../../i18n/locales";

const COPY = {
  zh: {
    heading: "之前的对话", loading: "正在找回这段会话…", refreshing: "正在更新这段会话…",
    failed: "这段会话暂时没加载出来", failedHint: "重新加载后，可以接着查看之前的内容。",
    refreshFailed: "更新暂时没完成，已显示的内容仍可查看。", partial: "部分内容还没恢复", partialHint: "已找回的文字和图片仍可查看。",
    retry: "重新加载", empty: "这段会话还没有可显示的内容。", scenesMissing: "这部分地点图片未能恢复。", draftMissing: "这版行程草案未能恢复。",
    continueDraft: "继续调整", continueHint: "恢复完成后，可以从这版草案继续调整。", noPictures: "暂无可查看的图片",
  },
  en: {
    heading: "Previous conversation", loading: "Restoring this conversation…", refreshing: "Updating this conversation…",
    failed: "This conversation couldn’t be loaded", failedHint: "Try loading it again to pick up where you left off.",
    refreshFailed: "The update didn’t finish. You can still view the content shown here.", partial: "Some content hasn’t been restored", partialHint: "The available messages and pictures are still here.",
    retry: "Load again", empty: "There’s no content to show in this conversation yet.", scenesMissing: "These place pictures couldn’t be restored.", draftMissing: "This itinerary draft couldn’t be restored.",
    continueDraft: "Continue adjusting", continueHint: "Once restoration finishes, you can continue from this draft.", noPictures: "No pictures available",
  },
  ja: {
    heading: "これまでの会話", loading: "会話を読み込み中…", refreshing: "この会話を更新中…",
    failed: "この会話を読み込めませんでした", failedHint: "再読み込みすると、前の内容から続きを確認できます。",
    refreshFailed: "更新できませんでした。表示中の内容は引き続き確認できます。", partial: "一部の内容を復元できていません", partialHint: "読み込めた会話と画像は確認できます。",
    retry: "再読み込み", empty: "この会話には、まだ表示できる内容がありません。", scenesMissing: "この場所の画像を復元できませんでした。", draftMissing: "この旅程案を復元できませんでした。",
    continueDraft: "調整を続ける", continueHint: "読み込みが完了すると、この旅程案から調整を続けられます。", noPictures: "表示できる画像がありません",
  },
} as const;

export function historyReplayCopy(locale: Locale) { return COPY[locale]; }
