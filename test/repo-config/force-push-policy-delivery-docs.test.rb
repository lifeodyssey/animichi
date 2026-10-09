# SUT: the delivery-facing policy docs — `docs/agents/delivery-flow.md` and the card-delivery
# runbook, plus the two index lines this policy touched. The flow's standing update step and
# the 21-conflict incident record are pinned verbatim; every other line of the flow is
# scanned for the retired update mechanics (a stack, a rebase, a forced push, in any spelling
# an author reaches for) with no date escape — only the incident record, whose step the owner
# superseded, may carry them, and it must carry its retirement date, and only the owner's
# 2026-09-17 words, exempted as a whole line and nothing else, may hold the stack vocabulary.
# A flow that teaches a stack or a rebase sends the next reader to push a way the owner
# retired (ADR 0009, 2026-10-09).
require "minitest/autorun"

class ForcePushPolicyDeliveryDocsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  FLOW = File.join(ROOT, "docs/agents/delivery-flow.md")
  RUNBOOK = File.join(ROOT, "docs/ops/orca-card-delivery.md")
  AGENTS = File.join(ROOT, "AGENTS.md")
  DOCS_POLICY = File.join(ROOT, "docs/DOCS_POLICY.md")

  # The retired update mechanics in any spelling: the words themselves (a bare rebase,
  # restack, any stack vocabulary), the forced-push spellings with the flag after the refspec
  # (`git push origin <branch> -f`, `--force`, the `+<branch>` refspec), the pull-update
  # flags (`git pull origin main -r`) and the stacked-PR shapes that survive dropping the
  # word stack (`--base <parent-branch>`, the parent branch, merge from the bottom). No /x
  # and no date alternative here: history needs these words (the owner's 2026-09-17
  # instruction, the 21-conflict incident), which is why the scan exempts the pinned
  # records and the owner's quoted line below and nothing else.
  RETIRED_MECHANICS = /rebase|stack|--force\b|push\b[^`\n]*\s-f\b|push\s+origin\s+\+|\bpull\b[^`\n]*\s-r\b|--base\b|parent branch|merge from the bottom/i
  # The pinned records quote command-shaped mechanics in their dated history; the standing
  # update step, which teaches the live path, must carry none of them.
  COMMAND_MECHANICS = /git rebase|pull -r|pull --rebase|push -f|push --force|--force-with-lease|gh-stack|--base\b|against the parent branch|merge from the bottom/i
  LIST_ITEM = /\A\s*(?:-|\d+\.)\s/.freeze
  INCIDENT_DATE = /2026-10-09/.freeze

  # The owner's 2026-09-17 words as the flow carries them: the one line outside the pinned
  # records that may hold the stack vocabulary. The exemption is whole-line equality, so a
  # retired step appended to the quote or set beside it is scanned like any other line.
  OWNER_QUOTE_LINE = '"记得用 stack pr，还有我之前说的，多个 issue 是一个 story 的就放一个 pr" (2026-09-17);'.freeze

  # The flow's standing update step and the incident record, verbatim. The scan below
  # exempts these two blocks and nothing else; editing either turns its own pin red.
  UPDATE_BULLET = <<~FLOW.chomp
    - Updating a branch is a merge: `git merge origin/main` + a normal push, or `gh pr update-branch`
      (ADR 0009, 2026-10-09) — never a rebase, never a force-push. A story that depends on another
      story's in-flight branch waits for that story's PR to land on `main`, then takes the same merge
      against the fresh head; stacked PRs are retired (owner, 2026-10-09, ADR 0009). Every merge
      keeps every other open PR a plain update away from current.
  FLOW
  INCIDENT_RECORD = <<~FLOW.chomp
    - Never chain a rebase and a dispatch in one command. A rebase that stopped on a conflict still let
      the dispatch fire, and the reviewer received a tree with 21 conflicted files. Require
      `git status --porcelain` empty and `git rebase --show-current-patch` silent first; a conflicted
      restack goes to the writer, hunk by hunk. (Superseded as a step 2026-10-09, ADR 0009: the
      branch update is a merge now. The guard is this incident's own lesson and stands: no chained
      update-and-dispatch, `git status --porcelain` empty before a dispatch.)
  FLOW

  def test_delivery_flow_updates_a_branch_by_merging_main_in
    update = blocks(File.read(FLOW)).find { |block| block.match?(/git merge origin\/main/) }
    assert_equal UPDATE_BULLET, update,
                 "the flow's standing update step drifted from its pinned text (ADR 0009)"
    refute_match COMMAND_MECHANICS, update.to_s,
                 "the standing update step carries retired rebase or force mechanics"
  end

  def test_delivery_flow_teaches_no_retired_step_outside_the_pinned_records
    flow = blocks(File.read(FLOW))
    incident = flow.find { |block| block.match?(/21 conflicted files/) }
    assert_equal INCIDENT_RECORD, incident,
                 "the 21-conflict incident record was rewritten; the history stays verbatim"
    assert_match INCIDENT_DATE, incident,
                 "the incident's superseded rebase step lost its retirement date"
    retired = (flow - [incident, UPDATE_BULLET]).flat_map { |block| block.lines.map(&:chomp) }
                                                .reject { |line| line == OWNER_QUOTE_LINE }
                                                .grep(RETIRED_MECHANICS)
    assert_empty retired,
                 "these flow lines spell the retired stacked-PR, rebase or force-push mechanics " \
                 "outside the pinned records and the owner's quoted words; the update is " \
                 "`git merge origin/main` (ADR 0009)"
  end

  def test_delivery_flow_keeps_the_owner_words_verbatim
    assert_match(/记得用 stack pr，还有我之前说的，多个 issue 是一个 story 的就放一个 pr/, File.read(FLOW),
                 "the owner's 2026-09-17 words were edited; quoted history stays verbatim")
  end

  def test_runbook_keeps_the_waiver_list_without_extending_it
    runbook = File.read(RUNBOOK)
    assert_match(/restack conflict resolution reported hunk by hunk/, runbook,
                 "the runbook rewrote the owner's 2026-09-18 waiver list; keep the original words")
    assert_match(/The stack step retired 2026-10-09/, runbook,
                 "the retired stack step lost its dated note")
    assert_nil(runbook.match(/update-branch[^.]*waiv/i),
               "the 2026-09-18 waiver does not cover update-branch conflicts; extending it is " \
               "an owner decision, not a doc edit")
  end

  def test_index_lines_match_the_retirement
    assert_includes File.read(AGENTS), "one story = one PR, branch updates by merge",
                    "AGENTS.md's delivery-flow line still sells stacked PRs"
    assert_match(/Registered ADRs 0001–0009/, File.read(DOCS_POLICY),
                 "DOCS_POLICY does not register ADR 0009")
  end

  private

  # Markdown blocks: a list item (bullet or numbered step) with its indented continuation
  # lines, or a paragraph — a paragraph after a list item is its own block, so the scan
  # sees it instead of folding it into the item above (review 2).
  def blocks(text)
    text.lines.slice_before { |line| new_block?(line) }.map(&:join).map(&:strip)
  end

  # A list item or an unindented, non-blank line starts a block; blank and indented
  # lines continue the block above them.
  def new_block?(line)
    line.match?(LIST_ITEM) || (line.match?(/\S/) && !line.start_with?(" ", "\t"))
  end
end
