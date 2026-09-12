/** In-character copy for the D1-D18 fallback states (issue #272 S1.6;
 * D15-D18 honest-error states from W1 #1220), split from i18n.ts to keep
 * the chat dictionary hub under the file cap. */

export interface ChatErrorStatesDict {
  readonly d1Title: string;
  readonly d1Hint: string;
  readonly d1Label: string;
  readonly d1Placeholder: string;
  readonly d1Submit: string;
  readonly d1Sent: string;
  readonly d2Title: string;
  readonly d2Hint: string;
  readonly d2Label: string;
  readonly d2Placeholder: string;
  readonly d2Submit: string;
  readonly d2Sent: string;
  readonly d2UnlocatedTitle: string;
  readonly d2UnlocatedHint: string;
  readonly d3Notice: string;
  readonly d3Chip: string;
  readonly d4Message: string;
  readonly d4Hint: string;
  readonly d4Retry: string;
  readonly d5Message: string;
  readonly d5Hint: string;
  readonly d5Retry: string;
  readonly d6Message: string;
  readonly d6Hint: string;
  readonly d6Retry: string;
  readonly d7Message: string;
  readonly d7Open: string;
  readonly d8Message: string;
  readonly d8Hint: string;
  readonly d8Login: string;
  readonly d8Resume: string;
  readonly d8ResumeHint: string;
  readonly d8Recovering: string;
  readonly d8RecoveringHint: string;
  readonly d9Episode: string;
  readonly d9Unavailable: string;
  readonly d9Failed: string;
  readonly d10Message: string;
  readonly d10Hint: string;
  readonly d10Retry: string;
  readonly d11Title: string;
  readonly d11Message: string;
  readonly d11Login: string;
  readonly d12Title: string;
  readonly d12Message: string;
  /** Same notice, naming the instant the allowance returns (`{time}`). */
  readonly d12MessageAt: string;
  readonly d12Login: string;
  readonly d12InputHint: string;
  /** D15-D17: the admission 409 family, honest per code (W1 #1220). */
  readonly d15Message: string;
  readonly d15Hint: string;
  readonly d15Retry: string;
  readonly d16Message: string;
  readonly d16Hint: string;
  readonly d16Retry: string;
  readonly d17Message: string;
  readonly d17Hint: string;
  readonly d17Retry: string;
  /** D18 keeps its code in expandable diagnostic details. */
  readonly d18Title: string;
  readonly d18Hint: string;
  readonly d18Message: string;
  readonly d18Retry: string;
  readonly interruptionDetails: string;
  readonly interruptionRecovering: string;
  readonly interruptionRecoveringHint: string;
}

export const jaErrorStates: ChatErrorStatesDict = {
  d1Title: "その作品が見つからなかった",
  d1Hint: "別のタイトルや、覚えている場面を教えてね。手がかりにして、もう一度探してみよう。",
  d1Label: "作品の手がかり",
  d1Placeholder: "作品名・あらすじなど",
  d1Submit: "手がかりを送る",
  d1Sent: "手がかりを送ったよ",
  d2Title: "巡礼スポットが見つからなかった",
  d2Hint: "別の作品や、行きたい地域から探してみよう。",
  d2Label: "次に探したい作品・地域",
  d2Placeholder: "作品名や都市名など",
  d2Submit: "もう一度探す",
  d2Sent: "リクエストを送ったよ",
  d2UnlocatedTitle: "地図に表示できる位置がまだない",
  d2UnlocatedHint: "上のスポット情報は引き続き見られるよ。",
  d3Notice: "スポットが少なめだから、みじかいおさんぽになりそう",
  d3Chip: "近くの別作品も足す?",
  d4Message: "接続が途切れたみたい",
  d4Hint: "もう一度試せるよ。入力し直さなくて大丈夫。",
  d4Retry: "もう一度試す",
  d5Message: "時間内に返事を届けられなかった",
  d5Hint: "同じメッセージでもう一度試せるよ。",
  d5Retry: "もう一度",
  d6Message: "うまく返事を届けられなかった",
  d6Hint: "もう一度試すか、このまま続きを教えてね。",
  d6Retry: "もう一度ためす",
  d7Message: "地図を読み込めませんでした",
  d7Open: "Google マップで開く",
  d8Message: "ログインの有効期限が切れたみたい",
  d8Hint: "もう一度ログインして、最新の会話を読み込んでね。",
  d8Login: "もう一度ログイン",
  d8Resume: "最新の会話を読み込む",
  d8ResumeHint: "ログインし直したら",
  d8Recovering: "最新の会話を読み込んでいるよ…",
  d8RecoveringHint: "上に表示されている内容は引き続き見られるよ。",
  d9Episode: "第{ep}話",
  d9Unavailable: "画像はまだありません",
  d9Failed: "画像を読み込めませんでした",
  d10Message: "少し待ってから試してね",
  d10Hint: "リクエストが一時的に制限されているよ。入力し直さなくて大丈夫。",
  d10Retry: "もう一度試す",
  d11Title: "ゲスト利用が一時停止中",
  d11Message: "本日のゲスト共通枠を使い切ったよ。ログインすると続きを話せるよ。",
  d11Login: "ログインして続ける",
  d12Title: "無料メッセージを使い切ったよ",
  d12Message: "利用枠が回復したら、また送れるよ。",
  d12MessageAt: "{time}から、また送れるよ。",
  d12Login: "ログインして続ける",
  d12InputHint: "書いておいて、あとで送信",
  d15Message: "前のメッセージをまだ処理しているよ",
  d15Hint: "少し待ってから、もう一度試してね。",
  d15Retry: "もう一度試す",
  d16Message: "会話が更新されているよ",
  d16Hint: "最新の会話を読み込んでから、続きを話そう。",
  d16Retry: "最新の会話を読み込む",
  d17Message: "さっきの操作を完了できなかった",
  d17Hint: "最新の会話を読み込んでから、もう一度進めよう。",
  d17Retry: "最新の会話を読み込む",
  d18Title: "返事を最後まで届けられなかった",
  d18Hint: "もう一度試せるよ。入力し直さなくて大丈夫。",
  d18Message: "エラーコード：{code}",
  d18Retry: "もう一度試す",
  interruptionDetails: "エラーの詳細",
  interruptionRecovering: "最新の会話を読み込んでいるよ…",
  interruptionRecoveringHint: "上に表示されている内容は引き続き見られるよ。",
};

export const zhErrorStates: ChatErrorStatesDict = {
  d1Title: "还没找到这部作品",
  d1Hint: "试试它的另一个名字，或告诉我一段你记得的剧情，我们接着找。",
  d1Label: "再给我一点作品线索",
  d1Placeholder: "作品名、原文标题或剧情",
  d1Submit: "发送线索",
  d1Sent: "线索已发送",
  d2Title: "暂时没有找到取景地",
  d2Hint: "可以试试其他作品，或从想去的地区开始找。",
  d2Label: "换部作品，或换个地区",
  d2Placeholder: "输入作品名或城市",
  d2Submit: "继续查找",
  d2Sent: "搜索请求已发送",
  d2UnlocatedTitle: "这些地点暂时没有可用坐标",
  d2UnlocatedHint: "可以继续查看上方的地点信息。",
  d3Notice: "地点有点少,会是一段短短的散步",
  d3Chip: "要不要把附近别的作品也加进来?",
  d4Message: "连接中断了",
  d4Hint: "可以再试一次，不用重新输入。",
  d4Retry: "再试一次",
  d5Message: "这次回复超时了",
  d5Hint: "可以直接重试这条消息，不用重新输入。",
  d5Retry: "再试一次",
  d6Message: "这次没能完成回复",
  d6Hint: "可以重试这条消息，也可以继续补充你的想法。",
  d6Retry: "再试一次",
  d7Message: "地图暂时没能加载",
  d7Open: "在 Google 地图中打开",
  d8Message: "登录状态已过期",
  d8Hint: "请重新登录，再读取最新对话。",
  d8Login: "重新登录",
  d8Resume: "读取最新对话",
  d8ResumeHint: "已完成登录？",
  d8Recovering: "正在读取最新对话…",
  d8RecoveringHint: "上方已有的内容仍可查看。",
  d9Episode: "第{ep}集",
  d9Unavailable: "暂无图片",
  d9Failed: "图片未能加载",
  d10Message: "请稍后再试",
  d10Hint: "这次请求暂时受限，不用重新输入。",
  d10Retry: "再试一次",
  d11Title: "游客体验暂时暂停",
  d11Message: "今天的公共体验额度已用完，登录后可以继续对话。",
  d11Login: "登录后继续",
  d12Title: "免费消息已用完",
  d12Message: "额度恢复后可以继续发送。",
  d12MessageAt: "{time} 后可以继续发送。",
  d12Login: "登录后继续",
  d12InputHint: "可以先写，稍后发送",
  d15Message: "上一条消息还在处理中",
  d15Hint: "稍等片刻后再试。",
  d15Retry: "再试一次",
  d16Message: "对话有更新",
  d16Hint: "先读取最新对话，再接着聊。",
  d16Retry: "读取最新对话",
  d17Message: "刚才那一步没有完成",
  d17Hint: "先读取最新对话，再继续这一步。",
  d17Retry: "读取最新对话",
  d18Title: "这次没能完成回复",
  d18Hint: "可以再试一次，不用重新输入。",
  d18Message: "错误代码：{code}",
  d18Retry: "再试一次",
  interruptionDetails: "错误详情",
  interruptionRecovering: "正在读取最新对话…",
  interruptionRecoveringHint: "上方已有的内容仍可查看。",
};

export const enErrorStates: ChatErrorStatesDict = {
  d1Title: "I couldn't find that title yet",
  d1Hint: "Try another name for it, or share a scene you remember. We can keep looking.",
  d1Label: "A little more about the anime",
  d1Placeholder: "Title or plot detail",
  d1Submit: "Send a clue",
  d1Sent: "Clue sent",
  d2Title: "No filming locations found yet",
  d2Hint: "Try another anime, or start with a region you'd like to visit.",
  d2Label: "Another anime or region",
  d2Placeholder: "Enter an anime title or city",
  d2Submit: "Keep looking",
  d2Sent: "Search request sent",
  d2UnlocatedTitle: "These places have no map coordinates yet",
  d2UnlocatedHint: "You can still browse the place information above.",
  d3Notice: "Only a few spots, so this will be a short stroll",
  d3Chip: "Add a nearby work too?",
  d4Message: "The connection dropped",
  d4Hint: "Try again without typing your message again.",
  d4Retry: "Try again",
  d5Message: "This reply timed out",
  d5Hint: "Retry this message without typing it again.",
  d5Retry: "Try again",
  d6Message: "I couldn't finish this reply",
  d6Hint: "Retry this message, or tell me a little more to continue.",
  d6Retry: "Try again",
  d7Message: "The map couldn’t load",
  d7Open: "Open in Google Maps",
  d8Message: "Your sign-in has expired",
  d8Hint: "Sign in again, then load the latest conversation.",
  d8Login: "Sign in again",
  d8Resume: "Load latest conversation",
  d8ResumeHint: "Already signed back in?",
  d8Recovering: "Loading the latest conversation…",
  d8RecoveringHint: "You can still read the content above.",
  d9Episode: "Ep. {ep}",
  d9Unavailable: "No image available",
  d9Failed: "Image couldn’t load",
  d10Message: "Please wait a moment before trying again",
  d10Hint: "Requests are temporarily limited. You don't need to type your message again.",
  d10Retry: "Try again",
  d11Title: "Guest chat is paused",
  d11Message: "Today's shared guest allowance is used up. Sign in to keep chatting.",
  d11Login: "Sign in to continue",
  d12Title: "You've used your free messages",
  d12Message: "You can send again when your allowance resets.",
  d12MessageAt: "Send again after {time}.",
  d12Login: "Sign in to continue",
  d12InputHint: "Write now, send later",
  d15Message: "Your last message is still being processed",
  d15Hint: "Give it a moment, then try again.",
  d15Retry: "Try again",
  d16Message: "The conversation has updates",
  d16Hint: "Load the latest conversation before continuing.",
  d16Retry: "Load latest conversation",
  d17Message: "That last step didn't finish",
  d17Hint: "Load the latest conversation, then continue from there.",
  d17Retry: "Load latest conversation",
  d18Title: "I couldn't finish this reply",
  d18Hint: "Try again without typing your message again.",
  d18Message: "Error code: {code}",
  d18Retry: "Try again",
  interruptionDetails: "Error details",
  interruptionRecovering: "Loading the latest conversation…",
  interruptionRecoveringHint: "You can still read the content above.",
};
