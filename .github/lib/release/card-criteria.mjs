/**
 * A card's acceptance criteria, read from the card body, so that "stalled on an
 * observation" can be told apart from "still needs development" (#1695
 * requirement 3).
 *
 * The card is the source of truth for what remains; the catalog is the source
 * of truth for which of those criteria need a deployed observation. Reading
 * both is what turns today's ambiguity — an AC nobody can verify looks exactly
 * like an AC nobody has verified — into a state with an owner.
 *
 * The AC number is the criterion's ordinal in the checklist, which is how the
 * cards already discuss themselves ("AC5", "AC3"), and the declared test type
 * is checked against the catalog: a card whose criteria are reordered or
 * retyped turns the check red instead of being proved by the wrong probe.
 */

/** The test types the repository gates acceptance criteria by (docs/agents/harness.md). */
const TEST_TYPES = ["unit", "integration", "eval", "browser", "api"];

const CHECKLIST_LINE = /^\s*-\s*\[([ xX])\]\s*(.*)$/;
const DECLARATION = /^\*\*\(([^)]+)\)\*\*\s*(.*)$/;

/** One criterion per checklist line, numbered by its position among ALL of
 * them. The declaration is read after the ordinal is fixed: a line whose test
 * type is missing or unrecognised is still a criterion with no recognised type,
 * never a line that renumbers every criterion after it. */
export function parseAcceptanceCriteria(body) {
  return lines(body)
    .map((line) => CHECKLIST_LINE.exec(line))
    .filter((matched) => matched !== null)
    .map((matched, ordinal) => criterion(matched, ordinal));
}

function lines(body) {
  return String(body ?? "").split("\n");
}

function criterion(matched, ordinal) {
  const declared = DECLARATION.exec(matched[2]);
  const testTypes = declared === null ? [] : declared[1].split(",").map((type) => type.trim()).filter((type) => TEST_TYPES.includes(type));
  return { acId: `AC${ordinal + 1}`, checked: matched[1] !== " ", testTypes, text: (declared === null ? matched[2] : declared[2]).trim() };
}

/** The catalog against the card: a criterion the card does not carry, or
 * carries under a different test type, is a catalog that proves something else. */
export function catalogDrift(card, criteria, entries) {
  return entries.flatMap((entry) => {
    const criterion = criteria.find((item) => item.acId === entry.ac);
    if (criterion === undefined) return [`${card} ${entry.ac} is not a criterion in the card`];
    if (criterion.testTypes.includes(entry.testType)) return [];
    const declared = criterion.testTypes.length === 0 ? "no recognized test type" : criterion.testTypes.join(", ");
    return [`${card} ${entry.ac} is declared ${entry.testType}; the card declares ${declared}`];
  });
}

/** Which of the card's unchecked criteria this catalog covers, and which it
 * does not.
 *
 * The checklist is the only per-criterion state a card carries, and it is NOT a
 * verification record: the four cards this catalog exists for record their
 * verification in issue comments and leave the boxes unchecked. So the counts
 * below are deliberately FACTS about coverage — "these unchecked criteria are
 * post-deploy, those are outside this catalog" — and never a claim that the
 * others still need code. A card that says "all post-deploy" and a card that
 * says "4 outside this catalog" are told apart at a glance without either
 * being mislabelled. */
export function outstanding(criteria, entries) {
  const postDeploy = new Set(entries.map((entry) => entry.ac));
  const remaining = criteria.filter((criterion) => !criterion.checked);
  const observed = remaining.filter((criterion) => postDeploy.has(criterion.acId));
  const outside = remaining.filter((criterion) => !postDeploy.has(criterion.acId));
  return { checked: criteria.length - remaining.length, remaining: remaining.length, postDeploy: observed.length, postDeployAcs: observed.map((criterion) => criterion.acId), outside: outside.map((criterion) => criterion.acId) };
}

/** One line, at a glance: a card whose only unchecked criteria are post-deploy
 * cannot be mistaken for one whose remaining evidence is not a deployed
 * observation. */
export function summaryLine(card, counts) {
  if (counts.remaining === 0) return `${card}: every acceptance criterion is checked`;
  if (counts.postDeploy === counts.remaining) return `${card}: every unchecked criterion is post-deploy (${counts.postDeployAcs.join(", ")}) — the only thing missing is a deploy observation`;
  if (counts.postDeploy === 0) return `${card}: no unchecked criterion is post-deploy — this card's remaining evidence is not a deployed observation`;
  return `${card}: ${counts.remaining} unchecked — ${counts.postDeploy} post-deploy (${counts.postDeployAcs.join(", ")}), ${counts.outside.length} outside this catalog (${counts.outside.join(", ")})`;
}
