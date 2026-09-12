import type { Locale } from "../../i18n/locales";

const copy = {
  zh: {
    title: "还有想调整的吗？", current: "接着这版调整", input: "调整想法", write: "写调整想法",
    add: "添加地点", picker: "挑选地点", done: "完成选点", empty: "这份草案暂时没有地点，先加一处吧。",
    changed: "地点已修改，更新后会重新安排顺序和停留建议。", viewpoints: "取景位置 · {selected}/{total}",
    pendingPlaces: "这版还在调整，原草案仍可查看。",
    placeholder: "比如：下午从新宿站出发，想逛得轻松一点。",
    suggestions: "加一句调整想法", later: "晚点出发", laterRequest: "想晚一点出发，帮我调整一下安排。",
    slower: "轻松一点", slowerRequest: "想逛得轻松一点，多留些时间拍照。",
    submit: "更新草案", back: "查看原草案", backShort: "原草案", updating: "正在调整…", retry: "再试一次",
    pending: "正在整理新的安排，原草案还在。", failed: "这次调整没完成，想法和原草案都还在。",
  },
  en: {
    title: "Anything else to change?", current: "Working from this draft", input: "Your changes", write: "Write your changes",
    add: "Add places", picker: "Choose places", done: "Done", empty: "No places in this draft. Add a place to continue.",
    changed: "Places changed. Update the draft for a new order and stay suggestions.", viewpoints: "Viewpoints · {selected}/{total}",
    pendingPlaces: "These changes are pending. The original draft is still available.",
    placeholder: "For example: start from Shinjuku in the afternoon, with a more relaxed pace.",
    suggestions: "Add a change", later: "Start later", laterRequest: "I'd like to start later. Please adjust the plan.",
    slower: "Take it slower", slowerRequest: "I'd like a more relaxed pace, with extra time for photos.",
    submit: "Update draft", back: "View original", backShort: "Original", updating: "Updating…", retry: "Try again",
    pending: "Updating the plan. Your previous draft is still available.", failed: "The update failed. Your request and previous draft are still here.",
  },
  ja: {
    title: "ほかに変えたいことは？", current: "この案をもとに調整", input: "変更したいこと", write: "変更の希望を書く",
    add: "場所を追加", picker: "場所を選ぶ", done: "選択を完了", empty: "まだ場所がありません。まず1か所追加しましょう。",
    changed: "場所を変更しました。更新すると順番と滞在の目安を考え直します。", viewpoints: "撮影ポイント · {selected}/{total}",
    pendingPlaces: "変更は調整中です。元の案も見られます。",
    placeholder: "例えば：午後に新宿駅から出発して、ゆっくり巡りたい。",
    suggestions: "変更の希望を追加", later: "遅めに出発", laterRequest: "出発を遅めにして、予定を調整したいです。",
    slower: "ゆっくり巡る", slowerRequest: "写真を撮る時間を多めにして、ゆっくり巡りたいです。",
    submit: "案を更新", back: "元の案を見る", backShort: "元の案", updating: "調整中…", retry: "もう一度",
    pending: "新しい予定を考えています。前の案も見られます。", failed: "調整できませんでした。入力内容と前の案は残っています。",
  },
};

export const draftAdjustmentCopy = (locale: Locale) => copy[locale];
