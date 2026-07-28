/**
 * BYOK settings panel copy (issue #284 Task 6).
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
  readonly modelLabel: string;
  readonly modelRequired: string;
  readonly baseUrlLabel: string;
  readonly baseUrlHelp: string;
  readonly save: string;
  readonly clear: string;
  readonly maskedSummary: string;
  readonly visionBadge: string;
  readonly errorCredentialRejected: string;
  readonly errorRequiresLogin: string;
  readonly errorInvalidRequest: string;
  readonly errorEgressBlocked: string;
  readonly notAccepted: string;
  readonly anonymousTeaser: string;
  readonly signInToSetUp: string;
}

export const jaByok: ChatByokDict = {
  title: "自分のAPIキーを使う",
  familyLabel: "サービスをえらんでね",
  familyOpenaiCompatible: "OpenAI互換",
  familyAnthropic: "Anthropic",
  familyGemini: "Gemini",
  apiKeyLabel: "APIキー",
  modelLabel: "モデル名",
  modelRequired: "モデル名を入力してね",
  baseUrlLabel: "接続先URL",
  baseUrlHelp: "https:// から始まるURLを入れてね",
  save: "保存する",
  clear: "解除する",
  maskedSummary: "登録ずみ(キーはひみつ)",
  visionBadge: "✓ 画像対応",
  errorCredentialRejected: "このキーは使えなかったみたい。もう一度確かめてね",
  errorRequiresLogin: "自分のキーを使うにはログインしてね",
  errorInvalidRequest: "入力に不備があるみたい。確認してね",
  errorEgressBlocked: "その接続先には安全のためつなげられないよ",
  notAccepted: "キーが受け付けられなかったよ。標準のモードでは続けないから、直してね",
  anonymousTeaser: "自分のAPIキーを使うと、待たずにたくさん話せるよ",
  signInToSetUp: "ログインして設定する",
};

export const zhByok: ChatByokDict = {
  title: "使用你自己的 API 密钥",
  familyLabel: "选择服务商",
  familyOpenaiCompatible: "OpenAI 兼容",
  familyAnthropic: "Anthropic",
  familyGemini: "Gemini",
  apiKeyLabel: "API 密钥",
  modelLabel: "模型名称",
  modelRequired: "请填写模型名称",
  baseUrlLabel: "接口地址",
  baseUrlHelp: "请填写以 https:// 开头的地址",
  save: "保存",
  clear: "清除",
  maskedSummary: "已保存(密钥已隐藏)",
  visionBadge: "✓ 支持图片",
  errorCredentialRejected: "这个密钥没能用,请再检查一下",
  errorRequiresLogin: "使用自己的密钥需要先登录",
  errorInvalidRequest: "填写的内容好像不对,请检查一下",
  errorEgressBlocked: "出于安全考虑,无法连接这个地址",
  notAccepted: "密钥没有被接受。不会用默认模式继续,请先修正",
  anonymousTeaser: "用你自己的密钥,就不用受限额限制啦",
  signInToSetUp: "登录后设置",
};

export const enByok: ChatByokDict = {
  title: "Use your own API key",
  familyLabel: "Choose a provider",
  familyOpenaiCompatible: "OpenAI-compatible",
  familyAnthropic: "Anthropic",
  familyGemini: "Gemini",
  apiKeyLabel: "API key",
  modelLabel: "Model name",
  modelRequired: "Please enter a model name",
  baseUrlLabel: "Base URL",
  baseUrlHelp: "Enter a URL starting with https://",
  save: "Save",
  clear: "Clear",
  maskedSummary: "Saved (key hidden)",
  visionBadge: "✓ Image support",
  errorCredentialRejected: "That key wasn't accepted. Please double-check it",
  errorRequiresLogin: "Sign in to use your own key",
  errorInvalidRequest: "Something in that entry looks off — please check it",
  errorEgressBlocked: "That address can't be reached for safety reasons",
  notAccepted: "Your key was not accepted. We won't continue on the standard mode — please fix it",
  anonymousTeaser: "Bring your own key to chat without the daily limit",
  signInToSetUp: "Sign in to set up",
};
