import type { Locale } from "../../i18n/locales";

const copy = {
  zh: {
    region: "草案保存操作", save: "保存草案", login: "登录并保存", saving: "正在保存…", saved: "草案已保存", view: "查看行程", viewLabel: "查看已保存行程", adjust: "调整一下", retry: "重新保存", checking: "请稍候…", unavailable: "暂时无法保存",
    loginHint: "登录后，就能保存这版草案，下次接着看。", savingHint: "正在保存这版草案，地点和图片仍可查看。", savedHint: "下次可以接着查看和调整。", retryHint: "这次没保存成功，草案还在，可以再试一次。", permanentHint: "这版草案暂时无法保存，仍可以继续查看和调整。", checkingHint: "正在确认登录状态。",
  },
  en: {
    region: "Draft save actions", save: "Save draft", login: "Sign in to save", saving: "Saving…", saved: "Draft saved", view: "View itinerary", viewLabel: "View saved itinerary", adjust: "Adjust", retry: "Try saving again", checking: "One moment…", unavailable: "Saving unavailable",
    loginHint: "Sign in to keep this draft and return to it later.", savingHint: "Saving this draft. You can still browse its places and photos.", savedHint: "Come back to view or adjust it anytime.", retryHint: "It didn't save this time. Your draft is still here. Try again.", permanentHint: "This draft can't be saved right now. You can still view and adjust it.", checkingHint: "Checking your sign-in status.",
  },
  ja: {
    region: "プラン案の保存操作", save: "この案を保存", login: "ログインして保存", saving: "保存中…", saved: "プラン案を保存しました", view: "プランを見る", viewLabel: "保存したプランを見る", adjust: "調整する", retry: "もう一度保存", checking: "確認中…", unavailable: "今は保存できません",
    loginHint: "ログインすると、この案を保存して後から見返せます。", savingHint: "この案を保存しています。場所や写真は引き続き見られます。", savedHint: "後から見返したり、調整したりできます。", retryHint: "保存できませんでした。この案は残っています。もう一度お試しください。", permanentHint: "この案は今は保存できません。引き続き見たり、調整したりできます。", checkingHint: "ログイン状態を確認しています。",
  },
};

export const draftSaveCopy = (locale: Locale) => copy[locale];
