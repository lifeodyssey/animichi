/** In-character copy for the D1-D12 fallback states (issue #272 S1.6),
 * split from i18n.ts to keep the chat dictionary hub under the file cap. */

export interface ChatErrorStatesDict {
  readonly d1Title: string;
  readonly d1Hint: string;
  readonly d1Subtitle: string;
  readonly d2Title: string;
  readonly d2Hint: string;
  readonly d3Notice: string;
  readonly d3Chip: string;
  readonly d4Message: string;
  readonly d4Retry: string;
  readonly d5Message: string;
  readonly d5Retry: string;
  readonly d6Message: string;
  readonly d6Retry: string;
  readonly d7Message: string;
  readonly d7Open: string;
  readonly d8Message: string;
  readonly d8Login: string;
  readonly d8Resume: string;
  readonly d9Episode: string;
  readonly d10Message: string;
  readonly d10Retry: string;
  readonly d11Message: string;
  readonly d11Login: string;
  readonly d12Message: string;
  /** Same notice, naming the instant the allowance returns (`{time}`). */
  readonly d12MessageAt: string;
  readonly d12Login: string;
  readonly d12InputHint: string;
}

export const jaErrorStates: ChatErrorStatesDict = {
  d1Title: "ごめんね、その作品が見つからなかった…",
  d1Hint: "つづりを確かめるか、原題でためしてみて。あらすじを教えてくれたら当ててみるよ",
  d1Subtitle: "うーん、見つからない…",
  d2Title: "この作品はまだ Anitabi に聖地が登録されていないみたい",
  d2Hint: "べつの作品でさがしてみる?",
  d3Notice: "スポットが少なめだから、みじかいおさんぽになりそう",
  d3Chip: "近くの別作品も足す?",
  d4Message: "接続が切れました",
  d4Retry: "再試行",
  d5Message: "時間がかかりすぎているみたい",
  d5Retry: "もう一度",
  d6Message: "ごめんね、うまく答えられなかった。言い方を変えてみてね",
  d6Retry: "もう一度ためす",
  d7Message: "地図をよみこめなかった…",
  d7Open: "地図アプリで開く",
  d8Message: "セッションが切れちゃった。ログインし直すと、この会話のつづきから話せるよ",
  d8Login: "ログインする",
  d8Resume: "つづきを読み込む",
  d9Episode: "第{ep}話",
  d10Message: "ちょっと混み合ってるみたい。少し待ってね",
  d10Retry: "もう一度おくる",
  d11Message: "今日はここまで。ログインすると、このつづきから一緒に旅の計画を立てられるよ",
  d11Login: "ログインする",
  d12Message: "今日ぶんのメッセージはここまで。ログインすれば、いま書いた文はそのまま送れるよ",
  d12MessageAt: "今日ぶんのメッセージはここまで。{time}にまた送れるようになるよ。ログインすれば、いま書いた文をすぐ送れる",
  d12Login: "ログインして続ける",
  d12InputHint: "ログインすると、この文が送れるよ",
};

export const zhErrorStates: ChatErrorStatesDict = {
  d1Title: "抱歉,没找到这部作品…",
  d1Hint: "检查一下拼写,或试试原文标题。告诉我一句剧情,我来猜猜看",
  d1Subtitle: "嗯…找不到呢…",
  d2Title: "这部作品好像还没有圣地被收录进 Anitabi",
  d2Hint: "要不要换部作品试试?",
  d3Notice: "地点有点少,会是一段短短的散步",
  d3Chip: "要不要把附近别的作品也加进来?",
  d4Message: "连接断开了",
  d4Retry: "重试",
  d5Message: "花的时间有点太久了",
  d5Retry: "再试一次",
  d6Message: "抱歉,这次没答好。换个说法试试吧",
  d6Retry: "再试一次",
  d7Message: "地图加载不出来…",
  d7Open: "在地图应用中打开",
  d8Message: "会话过期了。重新登录就能接着聊,内容不会丢",
  d8Login: "去登录",
  d8Resume: "继续加载",
  d9Episode: "第{ep}集",
  d10Message: "现在有点挤,稍微等一下哦",
  d10Retry: "再发一次",
  d11Message: "今天就聊到这儿啦。登录之后,就能接着一起把这趟旅程规划下去",
  d11Login: "去登录",
  d12Message: "今天的免费消息到这儿啦。登录之后,你刚写的这句可以直接发出去",
  d12MessageAt: "今天的免费消息到这儿啦。{time}就能再发。登录的话,你刚写的这句现在就能发出去",
  d12Login: "登录后继续",
  d12InputHint: "登录之后就能把这句发出去",
};

export const enErrorStates: ChatErrorStatesDict = {
  d1Title: "Sorry, I couldn't find that title…",
  d1Hint: "Check the spelling or try the original title. Tell me a bit of the plot and I'll take a guess",
  d1Subtitle: "Hmm, nothing turned up…",
  d2Title: "This work doesn't seem to have any spots on Anitabi yet",
  d2Hint: "Want to try another title?",
  d3Notice: "Only a few spots, so this will be a short stroll",
  d3Chip: "Add a nearby work too?",
  d4Message: "The connection dropped",
  d4Retry: "Retry",
  d5Message: "This is taking too long",
  d5Retry: "Try again",
  d6Message: "Sorry, I couldn't quite answer that. Try phrasing it differently",
  d6Retry: "Try again",
  d7Message: "The map wouldn't load…",
  d7Open: "Open in a map app",
  d8Message: "Your session expired. Sign in again to pick up right where we left off",
  d8Login: "Sign in",
  d8Resume: "Reload the conversation",
  d9Episode: "Ep. {ep}",
  d10Message: "Things are a little busy — hang on a moment",
  d10Retry: "Send again",
  d11Message: "That's it for today. Sign in and we can keep planning this trip together",
  d11Login: "Sign in",
  d12Message: "That's today's free messages. Sign in and the line you just wrote goes straight out",
  d12MessageAt: "That's today's free messages. You can send again at {time}. Sign in and the line you just wrote goes out now",
  d12Login: "Sign in to continue",
  d12InputHint: "Sign in and this one goes through",
};
