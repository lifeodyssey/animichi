/** C2t departure detection (issue #260 AC2): the chips trigger only when the
 * message asks for a route while stating neither a departure point nor a
 * time; a turn that already states both (or either) is never interrupted. */

const ROUTE_INTENT = /(ルート|route|路线|路線|行程|プラン|plan)/i;

const DEPARTURE_POINT =
  /(駅|站|station|出発|出发|depart|現在地|现在地|当前位置|from\s)/i;

const TIME_INFO =
  /(\d{1,2}\s?[:：時时点]|午前|午後|上午|下午|早上|晚上|am|pm|朝|夜|時間|小时|hours?)/i;

export function statesDeparturePoint(text: string): boolean {
  return DEPARTURE_POINT.test(text);
}

export function statesTime(text: string): boolean {
  return TIME_INFO.test(text);
}

export function needsDeparturePrompt(text: string): boolean {
  if (!ROUTE_INTENT.test(text)) return false;
  return !statesDeparturePoint(text) && !statesTime(text);
}
