/** Copy for the C3a/C3b search result cards and static map (issue #261 S1.4). */
export interface ChatSearchDict {
  readonly select: string;
  readonly spotCount: string;
  readonly areaFallback: string;
  readonly mapLabel: string;
}

export const jaSearch: ChatSearchDict = {
  select: "この聖地をえらぶ",
  spotCount: "{count}件",
  areaFallback: "エリア{n}",
  mapLabel: "聖地マップ",
};

export const zhSearch: ChatSearchDict = {
  select: "选择这个圣地",
  spotCount: "{count} 处",
  areaFallback: "区域{n}",
  mapLabel: "圣地地图",
};

export const enSearch: ChatSearchDict = {
  select: "Select this spot",
  spotCount: "{count} spots",
  areaFallback: "Area {n}",
  mapLabel: "Spot map",
};
