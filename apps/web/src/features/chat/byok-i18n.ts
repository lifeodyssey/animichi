/**
 * BYOK settings-page copy (issue #284 Task 6).
 *
 * Covers the three-family selector, the model field (required for
 * openai-compatible, pre-filled elsewhere), the base_url helper, the vision
 * badge, and every error code the container/edge can surface for a BYOK
 * turn. Kept feature-local and split out of `i18n.ts`, same as
 * `route-i18n.ts` / `search-i18n.ts`.
 */
export interface ChatByokDict {
  readonly title: string;
  readonly familyLabel: string;
  readonly familyOpenaiCompatible: string;
  readonly familyAnthropic: string;
  readonly familyGemini: string;
  readonly apiKeyLabel: string;
  readonly apiKeyRequired: string;
  readonly apiKeyInvalid: string;
  readonly modelLabel: string;
  readonly modelRequired: string;
  readonly baseUrlLabel: string;
  readonly baseUrlHelp: string;
  readonly baseUrlInvalid: string;
  readonly save: string;
  readonly clear: string;
  readonly maskedSummary: string;
  readonly visionBadge: string;
  readonly errorRequiresLogin: string;
  readonly errorInvalidRequest: string;
  readonly errorEgressBlocked: string;
  readonly notAcceptedTitle: string;
  readonly notAccepted: string;
  readonly anonymousTeaser: string;
  readonly signInToSetUp: string;
  readonly checking: string;
  readonly authPending: string;
  readonly errorUnreachable: string;
  readonly settingsToggle: string;
  readonly d11UseOwnKey: string;
  readonly upsellTitle: string;
  readonly upsellBenefit: string;
  readonly upsellCostLabel: string;
  readonly upsellCost: string;
  readonly upsellPrivacyLabel: string;
  readonly upsellPrivacy: string;
  readonly upsellAccount: string;
  readonly openSettings: string;
}

export const jaByok: ChatByokDict = {
  title: "自分のAPIキーを使う",
  familyLabel: "サービスをえらんでね",
  familyOpenaiCompatible: "OpenAI互換",
  familyAnthropic: "Anthropic",
  familyGemini: "Gemini",
  apiKeyLabel: "APIキー",
  apiKeyRequired: "APIキーを入力してね",
  apiKeyInvalid: "そのAPIキーは使えない文字が入ってるみたい。確認してね",
  modelLabel: "モデル名",
  modelRequired: "モデル名を入力してね",
  baseUrlLabel: "接続先URL",
  baseUrlHelp: "https:// から始まるURLを入れてね",
  baseUrlInvalid: "そのURLは使えない文字が入ってるみたい。ローマ字のアドレスを試してね",
  save: "保存する",
  clear: "解除する",
  maskedSummary: "登録ずみ(キーはひみつ)",
  visionBadge: "✓ 画像対応",
  errorRequiresLogin: "自分のキーを使うにはログインしてね",
  errorInvalidRequest: "入力に不備があるみたい。確認してね",
  errorEgressBlocked: "その接続先には安全のためつなげられないよ",
  notAcceptedTitle: "キーが受け付けられなかった",
  notAccepted: "キーとサービスの設定を確認して、もう一度送ってね。別のモデルには自動で切り替えないよ。",
  anonymousTeaser: "自分のAPIキーを使うと、待たずにたくさん話せるよ",
  signInToSetUp: "ログインして設定する",
  checking: "キーをかくにん中…",
  authPending: "ログイン状態をかくにん中…",
  errorUnreachable: "接続先につながらなかったよ。URLとネットワークを確かめてね",
  settingsToggle: "APIキー設定",
  d11UseOwnKey: "自分のキーを使う",
  upsellTitle: "自分のAPIキーでつづける",
  upsellBenefit: "自分で選んだAIサービスで、会話を続けられるよ。",
  upsellCostLabel: "料金",
  upsellCost: "利用料はAIサービスのアカウントに請求されるよ。",
  upsellPrivacyLabel: "キー",
  upsellPrivacy: "このブラウザのセッション中に保存し、リクエスト時に送信するよ。サーバーには保存しないよ。",
  upsellAccount: "ログイン後、APIキー設定へ進むよ。",
  openSettings: "キー設定を見直す",
};

export const zhByok: ChatByokDict = {
  title: "使用你自己的 API 密钥",
  familyLabel: "选择服务商",
  familyOpenaiCompatible: "OpenAI 兼容",
  familyAnthropic: "Anthropic",
  familyGemini: "Gemini",
  apiKeyLabel: "API 密钥",
  apiKeyRequired: "请填写 API 密钥",
  apiKeyInvalid: "这个 API 密钥里有不能使用的字符,请检查一下",
  modelLabel: "模型名称",
  modelRequired: "请填写模型名称",
  baseUrlLabel: "接口地址",
  baseUrlHelp: "请填写以 https:// 开头的地址",
  baseUrlInvalid: "这个地址里有不能使用的字符,请换成英文/数字格式的地址试试",
  save: "保存",
  clear: "清除",
  maskedSummary: "已保存(密钥已隐藏)",
  visionBadge: "✓ 支持图片",
  errorRequiresLogin: "使用自己的密钥需要先登录",
  errorInvalidRequest: "填写的内容好像不对,请检查一下",
  errorEgressBlocked: "出于安全考虑,无法连接这个地址",
  notAcceptedTitle: "密钥未被接受",
  notAccepted: "请检查密钥和服务商设置，再发送这条消息。不会自动换用其他模型。",
  anonymousTeaser: "用你自己的密钥,就不用受限额限制啦",
  signInToSetUp: "登录后设置",
  checking: "正在检查密钥…",
  authPending: "正在检查登录状态…",
  errorUnreachable: "连不上这个接口地址,请检查 URL 和网络",
  settingsToggle: "API 密钥设置",
  d11UseOwnKey: "使用自己的密钥",
  upsellTitle: "用自己的 API 密钥继续",
  upsellBenefit: "用你选择的模型服务继续对话。",
  upsellCostLabel: "费用",
  upsellCost: "由你的模型服务商账户计费。",
  upsellPrivacyLabel: "密钥",
  upsellPrivacy: "在本次浏览器会话中保存；随请求传递，不在服务器保存。",
  upsellAccount: "登录后前往密钥设置。",
  openSettings: "修改密钥",
};

export const enByok: ChatByokDict = {
  title: "Use your own API key",
  familyLabel: "Choose a provider",
  familyOpenaiCompatible: "OpenAI-compatible",
  familyAnthropic: "Anthropic",
  familyGemini: "Gemini",
  apiKeyLabel: "API key",
  apiKeyRequired: "Please enter an API key",
  apiKeyInvalid: "That API key contains characters that can't be used — please check it",
  modelLabel: "Model name",
  modelRequired: "Please enter a model name",
  baseUrlLabel: "Base URL",
  baseUrlHelp: "Enter a URL starting with https://",
  baseUrlInvalid: "That URL contains characters that can't be used — try an ASCII/punycode address",
  save: "Save",
  clear: "Clear",
  maskedSummary: "Saved (key hidden)",
  visionBadge: "✓ Image support",
  errorRequiresLogin: "Sign in to use your own key",
  errorInvalidRequest: "Something in that entry looks off — please check it",
  errorEgressBlocked: "That address can't be reached for safety reasons",
  notAcceptedTitle: "Your key wasn't accepted",
  notAccepted: "Check your key and provider settings, then send this message again. We won't automatically switch models.",
  anonymousTeaser: "Bring your own key to chat without the daily limit",
  signInToSetUp: "Sign in to set up",
  checking: "Checking your key…",
  authPending: "Checking your sign-in status…",
  errorUnreachable: "Couldn't reach that endpoint — check the URL and your network",
  settingsToggle: "API key settings",
  d11UseOwnKey: "Use your own key",
  upsellTitle: "Continue with your own API key",
  upsellBenefit: "Keep chatting with the AI service you choose.",
  upsellCostLabel: "Cost",
  upsellCost: "Usage is billed to your provider account.",
  upsellPrivacyLabel: "Key",
  upsellPrivacy: "Saved for this browser session and sent with requests; never stored on our server.",
  upsellAccount: "Sign in to go to API key settings.",
  openSettings: "Review key settings",
};
