/** Copy for C2 clarification, C2t departure chips, C4 location prompt, and
 * photo search (issue #260 S1.3). Kept feature-local like the other chat
 * dictionaries to avoid the shared hot file. */

export interface ChatClarifyDict {
  readonly choosePrompt: string;
  readonly detailPrompt: string;
  readonly locationPrompt: string;
  readonly rephraseAction: string;
  readonly question: string;
  readonly escapeHatch: string;
  readonly rephraseHint: string;
  readonly manualChip: string;
  readonly animeNotFoundPrompt: string;
  readonly unknownPlacePrompt: string;
  readonly placeTooBroadPrompt: string;
  readonly titleLabel: string;
  readonly titlePlaceholder: string;
  readonly titleHint: string;
  readonly placeLabel: string;
  readonly placePlaceholder: string;
  readonly placeHint: string;
  readonly detailPlaceholder: string;
  readonly backToChoices: string;
  readonly submitDetail: string;
  readonly sentDetail: string;
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
  readonly current: string;
  readonly waiting: string;
  readonly sent: string;
  readonly manualLabel: string;
  readonly denied: string;
  readonly manualPlaceholder: string;
  readonly manualSubmit: string;
  readonly granted: string;
}

export interface ChatPhotoDict {
  readonly upload: string;
  readonly uploading: string;
  readonly unsupported: string;
  readonly tooLarge: string;
  readonly failed: string;
  readonly retry: string;
  readonly processedNote: string;
  readonly quotaNoByok: string;
  readonly quotaByokNoVision: string;
}

export const jaClarify: ChatClarifyDict = {
  choosePrompt: "探しているのはどれ？",
  detailPrompt: "もう少し詳しく教えてくれる？",
  locationPrompt: "どのあたりから探そうか？",
  rephraseAction: "もう少し詳しく伝える",
  question: "この写真、どの作品か教えてくれる?",
  escapeHatch: "どれでもない、言い直すね",
  rephraseHint: "行きたい場所や、やってみたいことを教えてね。",
  manualChip: "作品名を自分で入力する",
  animeNotFoundPrompt: "その作品が見つからなかったよ",
  unknownPlacePrompt: "その場所をもう少し詳しく教えてくれる？",
  placeTooBroadPrompt: "どのエリアを歩きたい？",
  titleLabel: "作品名",
  titlePlaceholder: "例：響け！ユーフォニアム",
  titleHint: "別の表記や、わかる範囲の作品名でも大丈夫。",
  placeLabel: "エリア・駅・目印",
  placePlaceholder: "例：京都の宇治駅",
  placeHint: "市区町村や駅名、近くの目印があると探しやすいよ。",
  detailPlaceholder: "例：宇治で半日、ゆっくり歩きたい",
  backToChoices: "候補に戻る",
  submitDetail: "これで伝える",
  sentDetail: "送信したよ。会話で続きを確認してね。",
};

export const zhClarify: ChatClarifyDict = {
  choosePrompt: "你想找的是哪一个？",
  detailPrompt: "可以再描述得具体一些吗？",
  locationPrompt: "你想从哪里开始找？",
  rephraseAction: "补充描述",
  question: "这张照片是哪部作品呢？",
  escapeHatch: "都不是，我换个说法",
  rephraseHint: "告诉我想去哪里，或者想怎样安排这次散步。",
  manualChip: "自己输入作品名",
  animeNotFoundPrompt: "还没找到这部作品",
  unknownPlacePrompt: "可以把地点说得具体一些吗？",
  placeTooBroadPrompt: "你想逛哪一片区域？",
  titleLabel: "作品名",
  titlePlaceholder: "例如：吹响吧！上低音号",
  titleHint: "可以试试其他译名，记得部分名称也没关系。",
  placeLabel: "区域、车站或地标",
  placePlaceholder: "例如：京都的宇治站",
  placeHint: "加上所在城市、车站名或附近地标，会更容易找到。",
  detailPlaceholder: "例如：想在宇治慢慢逛半天",
  backToChoices: "返回候选",
  submitDetail: "补充给你",
  sentDetail: "已发送，可以在对话中查看后续。",
};

export const enClarify: ChatClarifyDict = {
  choosePrompt: "Which one did you mean?",
  detailPrompt: "Could you tell me a little more?",
  locationPrompt: "Where should we start looking?",
  rephraseAction: "Add more detail",
  question: "Which title is this photo from? Tell me!",
  escapeHatch: "None of these — let me rephrase",
  rephraseHint: "Tell me where you'd like to go or what you have in mind.",
  manualChip: "Type the title myself",
  animeNotFoundPrompt: "I haven't found that title yet",
  unknownPlacePrompt: "Could you be more specific about the place?",
  placeTooBroadPrompt: "Which area would you like to explore?",
  titleLabel: "Anime title",
  titlePlaceholder: "e.g. Sound! Euphonium",
  titleHint: "Try another spelling or as much of the title as you remember.",
  placeLabel: "Area, station, or landmark",
  placePlaceholder: "e.g. Uji Station in Kyoto",
  placeHint: "A city, station name, or nearby landmark will help narrow it down.",
  detailPlaceholder: "e.g. A relaxed half-day walk in Uji",
  backToChoices: "Back to choices",
  submitDetail: "Send details",
  sentDetail: "Sent. Follow the conversation for what comes next.",
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
  allow: "現在地からさがす",
  current: "現在地",
  waiting: "現在地を確認中… 場所を入力して続けることもできるよ。",
  sent: "場所を送信したよ。",
  manualLabel: "または、場所を入力",
  denied: "位置情報が使えないみたい。場所を教えてくれたら、そこからさがすよ",
  manualPlaceholder: "例: 宇治駅",
  manualSubmit: "ここからさがす",
  granted: "現在地から近くの聖地をさがして",
};

export const zhLocation: ChatLocationDict = {
  allow: "使用当前位置",
  current: "当前位置",
  waiting: "正在获取位置，也可以直接填写地点继续。",
  sent: "地点已发送",
  manualLabel: "或输入一个地点",
  denied: "位置信息好像用不了。告诉我一个地点,我从那里帮你找",
  manualPlaceholder: "例如：宇治站",
  manualSubmit: "从这里找",
  granted: "从当前位置找找附近的圣地",
};

export const enLocation: ChatLocationDict = {
  allow: "Use my current location",
  current: "Current location",
  waiting: "Finding your location… You can also enter a place to continue.",
  sent: "Location sent",
  manualLabel: "Or enter a place",
  denied: "Location isn't available. Tell me a place and I'll search from there",
  manualPlaceholder: "e.g. Uji Station",
  manualSubmit: "Search from here",
  granted: "Find spots near my current location",
};

export const jaPhoto: ChatPhotoDict = {
  upload: "写真から聖地をさがす",
  uploading: "写真をみてるよ…",
  unsupported: "この形式の画像はよめないみたい。JPEG・PNG・WebP でためしてね",
  tooLarge: "この写真はおおきすぎるみたい。8MB までの写真でためしてね",
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
  tooLarge: "这张照片太大了。请试试 8MB 以内的照片吧",
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
  tooLarge: "That photo is a bit too big. Try one under 8MB",
  failed: "The upload didn't go through…",
  retry: "Try again",
  processedNote: "Images are processed on Animichi's quota",
  quotaNoByok:
    "Today's photo-search quota is used up. Add your own vision-capable key to keep going",
  quotaByokNoVision:
    "Your key doesn't seem to handle images. Switch to a vision-capable endpoint, or wait for tomorrow's reset",
};
