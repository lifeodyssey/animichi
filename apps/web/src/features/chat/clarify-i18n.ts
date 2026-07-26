/** Copy for C2 clarification, C2t departure chips, C4 location prompt, and
 * photo search (issue #260 S1.3). Kept feature-local like the other chat
 * dictionaries to avoid the shared hot file. */

export interface ChatClarifyDict {
  readonly question: string;
  readonly escapeHatch: string;
  readonly rephraseHint: string;
  readonly manualChip: string;
}

export interface ChatDepartureDict {
  readonly prompt: string;
  readonly stationChip: string;
  readonly hereChip: string;
  readonly manualChip: string;
  readonly autoChip: string;
  readonly stationSuffix: string;
}

export interface ChatLocationDict {
  readonly allow: string;
  readonly denied: string;
  readonly manualPlaceholder: string;
  readonly manualSubmit: string;
  readonly granted: string;
}

export interface ChatPhotoDict {
  readonly upload: string;
  readonly uploading: string;
  readonly unsupported: string;
  readonly failed: string;
  readonly retry: string;
  readonly processedNote: string;
  readonly quotaNoByok: string;
  readonly quotaByokNoVision: string;
}

export const jaClarify: ChatClarifyDict = {
  question: "この写真、どの作品か教えてくれる?",
  escapeHatch: "どれでもない、言い直すね",
  rephraseHint: "オッケー、もう一度きかせて!",
  manualChip: "作品名を自分で入力する",
};

export const zhClarify: ChatClarifyDict = {
  question: "这张照片是哪部作品呢?告诉我吧",
  escapeHatch: "都不是,我换个说法",
  rephraseHint: "好,再说一次吧!",
  manualChip: "自己输入作品名",
};

export const enClarify: ChatClarifyDict = {
  question: "Which title is this photo from? Tell me!",
  escapeHatch: "None of these — let me rephrase",
  rephraseHint: "Okay, tell me again!",
  manualChip: "Type the title myself",
};

export const jaDeparture: ChatDepartureDict = {
  prompt: "どこから、いつ出発する?",
  stationChip: "駅から+時間",
  hereChip: "現在地から",
  manualChip: "自分で入力する",
  autoChip: "おまかせ",
  stationSuffix: "。最寄り駅から出発で、時間はおまかせ",
};

export const zhDeparture: ChatDepartureDict = {
  prompt: "从哪里出发,几点出发?",
  stationChip: "从车站+时间",
  hereChip: "从当前位置",
  manualChip: "自己输入",
  autoChip: "都交给你",
  stationSuffix: "。从最近的车站出发,时间交给你安排",
};

export const enDeparture: ChatDepartureDict = {
  prompt: "Where from, and when?",
  stationChip: "From a station + time",
  hereChip: "From here",
  manualChip: "Type it myself",
  autoChip: "You decide",
  stationSuffix: ". Start from the nearest station; you pick the time",
};

export const jaLocation: ChatLocationDict = {
  allow: "位置情報を許可",
  denied: "位置情報が使えないみたい。場所を教えてくれたら、そこからさがすよ",
  manualPlaceholder: "例: 宇治駅",
  manualSubmit: "ここからさがす",
  granted: "現在地から近くの聖地をさがして",
};

export const zhLocation: ChatLocationDict = {
  allow: "允许使用位置信息",
  denied: "位置信息好像用不了。告诉我一个地点,我从那里帮你找",
  manualPlaceholder: "例如: 宇治站",
  manualSubmit: "从这里找",
  granted: "从当前位置找找附近的圣地",
};

export const enLocation: ChatLocationDict = {
  allow: "Allow location access",
  denied: "Location isn't available. Tell me a place and I'll search from there",
  manualPlaceholder: "e.g. Uji Station",
  manualSubmit: "Search from here",
  granted: "Find spots near my current location",
};

export const jaPhoto: ChatPhotoDict = {
  upload: "写真から聖地をさがす",
  uploading: "写真をみてるよ…",
  unsupported: "この形式の画像はよめないみたい。JPEG・PNG・WebP でためしてね",
  failed: "アップロードがうまくいかなかった…",
  retry: "もう一度ためす",
  processedNote: "画像は Animichi の枠で処理",
  quotaNoByok:
    "今日の写真検索の枠を使いきっちゃった。ビジョン対応の自分のキーを設定すると、もっと使えるよ",
  quotaByokNoVision:
    "いまのキーは画像に対応していないみたい。ビジョン対応のエンドポイントに切りかえるか、明日の回復を待ってね",
};

export const zhPhoto: ChatPhotoDict = {
  upload: "用照片找圣地",
  uploading: "正在看这张照片…",
  unsupported: "读不了这种格式的图片。试试 JPEG、PNG 或 WebP 吧",
  failed: "上传没有成功…",
  retry: "再试一次",
  processedNote: "图片由 Animichi 的额度处理",
  quotaNoByok: "今天的照片搜索额度用完了。配置一个支持视觉的自有密钥,就能继续用哦",
  quotaByokNoVision:
    "现在的密钥好像不支持图片。换一个支持视觉的端点,或者等明天额度恢复吧",
};

export const enPhoto: ChatPhotoDict = {
  upload: "Search by photo",
  uploading: "Looking at your photo…",
  unsupported: "I can't read this format. Try JPEG, PNG, or WebP",
  failed: "The upload didn't go through…",
  retry: "Try again",
  processedNote: "Images are processed on Animichi's quota",
  quotaNoByok:
    "Today's photo-search quota is used up. Add your own vision-capable key to keep going",
  quotaByokNoVision:
    "Your key doesn't seem to handle images. Switch to a vision-capable endpoint, or wait for tomorrow's reset",
};
