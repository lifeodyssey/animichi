/** Appbar copy (design sync `.appbar`): the two-line wordmark, the new-chat
 * action, and the identity slot. `tagline` stays the latin "AI GUIDE" lockup in
 * every locale — it is part of the mark, set 10.5px/800 with 1.5px tracking,
 * not a sentence — but it travels through the dictionary so a locale can take
 * its own line later without touching the component. */
export interface ChatAppBarDict {
  /** SD-16 brand name: 聖地巡礼 / 圣地巡礼 / Animichi. */
  readonly brand: string;
  readonly tagline: string;
  readonly newConversation: string;
  readonly signedIn: string;
  readonly login: string;
  readonly settings: string;
}

export const jaAppBar: ChatAppBarDict = {
  brand: "聖地巡礼",
  tagline: "AI GUIDE",
  newConversation: "新しい会話",
  signedIn: "ログイン中",
  login: "ログイン",
  settings: "設定",
};

export const zhAppBar: ChatAppBarDict = {
  brand: "圣地巡礼",
  tagline: "AI GUIDE",
  newConversation: "新对话",
  signedIn: "已登录",
  login: "登录",
  settings: "设置",
};

export const enAppBar: ChatAppBarDict = {
  brand: "Animichi",
  tagline: "AI GUIDE",
  newConversation: "New chat",
  signedIn: "Signed in",
  login: "Log in",
  settings: "Settings",
};
