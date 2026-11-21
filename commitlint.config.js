// The one commit-message validator (#1371). The commit-msg hook
// (.pre-commit-config.yaml) and CI's `commits` job both read this file, so a
// subject that passes locally passes the pull request too. It replaced
// scripts/local-gates/commit-message.py, whose tables (`type-enum`,
// `scope-enum`, `header-max-length` 72) and subject checks (GENERIC_OUTCOMES,
// the lowercase-verb start, the issue-ref ban, the AI-attribution ban) are the
// rules below. Merge/Revert subjects stay exempt, as they were there. The 72 is
// now the local `header-max-length-except-dependabot`: the owner exempted
// Dependabot's own commits from the header length alone (2026-11-21), and
// DEPENDABOT_SIGN_OFF below is how such a commit is recognised.

const TYPES = [
  'feat',
  'fix',
  'refactor',
  'perf',
  'test',
  'docs',
  'ci',
  'build',
  'ops',
  'chore',
  'revert',
];

const SCOPES = [
  'agent',
  'web',
  'chat',
  'catalog',
  'users',
  'auth',
  'edge',
  'contract',
  'db',
  'infra',
  'delivery',
  'eval',
  'e2e',
  'repo',
  'deps',
];

const GENERIC_OUTCOMES = new Set([
  'wip',
  'work in progress',
  'checkpoint',
  'fix',
  'fixes',
  'fixed',
  'fix it',
  'update',
  'updates',
  'updated',
  'update code',
  'update files',
  'changes',
  'misc',
  'misc changes',
  'review',
  'polish',
  'format',
  'formatting',
  'lint',
  'ci',
  'tests',
  'comments',
]);

const AI_IDENTITY = /\b(?:claude|anthropic|codex|openai)\b/i;

// GitHub's squash merge appends ` (#N)` to the pull request title it was told to
// use as the subject (`squash_merge_commit_title=PR_TITLE`), so every commit the
// merge button lands on `main` carries that one suffix and no author can remove
// it: the rule below cannot refuse a history the repository itself generates
// (#1804). The exemption is exactly that suffix — a reference anywhere else in
// the subject is still rejected.
const SQUASH_MERGE_SUFFIX = / \(#\d+\)$/;

// Dependabot signs every commit it writes with this trailer. A grouped update's
// header runs to about 90 characters, so on 2026-11-21 the owner approved one
// exemption: a commit whose footer carries this exact line is not held to the
// header length, and every other rule still judges it. The global `ignores`
// above would skip every rule for such a commit, which is wider than that.
// commitlint's parser opens the footer at the first `Token: value` line, so the
// line is footer wherever it stands below the header. A PR title is one line
// with no footer, so the title lint still holds it to 72; the squash merge uses
// it as `main`'s subject and appends ` (#N)`.
const DEPENDABOT_SIGN_OFF = 'Signed-off-by: dependabot[bot] <support@github.com>';

const signedByDependabot = (footer) =>
  String(footer ?? '')
    .split('\n')
    .includes(DEPENDABOT_SIGN_OFF);

module.exports = {
  extends: ['@commitlint/config-conventional'],
  ignores: [
    // GIT_MAINTENANCE_PATTERN: the local hook never sees these either —
    // squash merges and branch-sync merges carry no reviewable outcome.
    (commit) => /^(?:Merge .+|Revert ".+")$/.test(commit),
  ],
  rules: {
    'type-enum': [2, 'always', TYPES],
    'scope-enum': [2, 'always', SCOPES],
    // Off, not deleted: a deleted line would inherit config-conventional's 100.
    // The local rule below holds every other commit to the same 72.
    'header-max-length': [0],
    'header-max-length-except-dependabot': [2, 'always', 72],
    'subject-empty': [2, 'never'],
    'type-empty': [2, 'never'],
    'subject-case': [
      2,
      'never',
      ['sentence-case', 'start-case', 'pascal-case', 'upper-case'],
    ],
    'outcome-not-generic': [2, 'always'],
    'outcome-lowercase-start': [2, 'always'],
    'subject-no-issue-reference': [2, 'always'],
    'ai-attribution-forbidden': [2, 'always'],
  },
  plugins: [
    {
      rules: {
        // commitlint's own header-max-length check and refusal text, skipped
        // for a commit Dependabot signed.
        'header-max-length-except-dependabot': ({ header, footer }, _when, max) => [
          signedByDependabot(footer) ||
            (typeof header === 'string' && header.length <= max),
          `header must not be longer than ${max} characters, current length is ${header?.length}`,
        ],
        'outcome-not-generic': ({ subject }) => {
          const outcome = String(subject ?? '')
            .toLowerCase()
            .replace(/^[ \t.!?:;_-]+|[ \t.!?:;_-]+$/g, '');
          return [
            !GENERIC_OUTCOMES.has(outcome),
            `outcome '${subject}' is a generic outcome; describe what changed`,
          ];
        },
        'outcome-lowercase-start': ({ subject }) => [
          /^[a-z]/.test(String(subject ?? '')),
          'outcome must start with a lowercase verb',
        ],
        'subject-no-issue-reference': ({ subject }) => [
          !/#\d+/.test(String(subject ?? '').replace(SQUASH_MERGE_SUFFIX, '')),
          'subject must not carry an issue reference (Refs: belongs in the body)',
        ],
        'ai-attribution-forbidden': ({ body, footer }) => {
          const text = `${body ?? ''}\n${footer ?? ''}`;
          const coauthored = text
            .split('\n')
            .filter((line) => /^co-authored-by\s*:/i.test(line));
          return [
            !(
              coauthored.some((line) => AI_IDENTITY.test(line)) ||
              /generated with .*\b(?:claude|anthropic|codex|openai)\b/i.test(text)
            ),
            'commits must not carry AI attribution (Co-Authored-By identity or Generated-with footer)',
          ];
        },
      },
    },
  ],
};
