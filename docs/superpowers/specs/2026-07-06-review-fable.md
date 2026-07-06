# Complementary Spec Review — Fable reviewer (HEAD c14279d)

> Companion to 2026-07-06-review-codex.md (do not duplicate). Verdict: request_changes — all findings are text-layer; one focused revision pass brings the package to approve.

## 1. Quality Ratchet Table

| File | Stories | ac_total | ac_with_test | Gap |
|---|---|---|---|---|
| main spec | — (train claims 9/12/9/9/7/8/6/7) | 0 (global DoD only) | — | story counts drift vs 6 of 8 iter files (iter-1 drift NEW, P1-1) |
| iter-0 | 9 | 40 | 40 | ✓ (S0.8 spec'd behavior w/o AC — P1-7) |
| iter-1 | 13 (+2 unnumbered addenda) | 100 (+5) | 99 (+5) | **S1.2: 8/7** untagged descriptive note in AC list — P1-6 |
| iter-2 | 10 | 55 | 55 | ✓ |
| iter-3 | 10 | 43 | 43 | ✓ (S3.6 tag/text mismatch, P2-3) |
| iter-4 | 9 | 44 | 44 | ✓ |
| iter-5 | 10 | 49 | 49 | ✓ |
| iter-6 | 6 | 22 | 22 | ✓ |
| iter-7 | 9 (+S7.3 frozen) | 37 | 37 | ✓ |
| **Total** | **76** | **~395** | **~394** | 1 untagged AC + 3 untested spec'd behaviors |

## 2. Detail Heat-Map

- iter-0: S0.4 adequate, S0.7 adequate, rest **full**
- iter-1: S1.1–S1.13 **all full**
- iter-2: S2.10 adequate, rest full
- iter-3: S3.9 adequate; S3.1–S3.8, S3.10 **thin** (Scope-style, by design "pre-kickoff refinement")
- iter-4/5/6/7: **thin** across (Scope-style, by design; S4.8/S4.9 content-dense but untemplated)
- **iter-0/iter-1 thin list: EMPTY** — execution-ready after point fixes.

## 3. New P1 findings (not in review-codex.md)

1. iter-1.md header "Story count: 13" vs main spec §③ "12" — the drift class Codex flagged for iters 2/3/4/5/7 also applies to iter-1 (S1.13 added w/o train re-sync).
2. iter-3.md line 5 dependency order `… → S3.5 → S3.6 → …` contradicts S3.5's own deps ("S3.2, S3.6") — order should be S3.6 → S3.5 (no cycle).
3. **seo-geo-plan.md is entirely Chinese** — violates the SD-30 language convention the main spec itself quotes (it is a review object + executor input; must be translated).
4. S1.11 "Quota boundary" (SD-20: BYOK exempt from X4 budget but NOT from injection/validator/rate guards) has **zero ACs** — untested finalized behavior.
5. S1.7's P5 login-wall trigger ("magic-link modal opens only on 保存する tap; no earlier interruption") appears only as untagged prose — no AC for trigger timing/invariant.
6. S1.2 ratchet violation — 8 AC items, 7 tagged; move the descriptive contract note out of the AC list.
7. S0.8 drops an AC mandated by its authority source — seo-geo-plan §3 item 4 requires "grep whole repo, no old-domain hardcode residue"; S0.8 has no such assertion.

## 4. New P2 findings

1. S2.7 multi-turn AC forward-references Walk (ships iter-3) — rephrase as "after route `status` → `completed`".
2. iter-3 S3.5 heading uses 強光/夜間/離線 as pseudo-Japanese labels — 離線 is Chinese; use English state names or mark as canvas-label quotes.
3. S3.6 X7 AC text says "a unit test asserts the route-matching table" but tagged `-> browser` — tag/mechanism mismatch.
4. S0.8 crawler-reachability + GSC/Bing verification ACs tagged `integration` but are post-deploy manual/external — retag as manual/ops checklist or move to Tester post-deploy walk.
5. S0.8 checklist item 2 (old-domain full-path 301 Worker rule) in Files-changed but no AC.
6. Main spec §③ table rows for iterations 2/4/6 missing the File-column cell — breaks table/file linkage.
7. S1.7's "⚠️ Needs confirmation with the Coordinator" framing of S1.7/S2.8 boundary is stale — C4 already ruled confirmed/complementary; drop pending framing, keep cross-reference.

## 5. Passing dimensions (no new findings)

- Design-authority conflicts: all grep spot-checks pass (5 md files, 24 canvas count exact, A2b/C2/D1–D9/SP8/SP9 present, fox-walk 512×512 y=430 8/4-frame match, DESIGN.md token-gap claim accurate).
- DD-1~24 freeze discipline: all 76 stories verified, zero frozen items scheduled (S7.9/DD-19, S7.3/DD-10, S1.13/DD-23, S5.7/DD-14, S1.12/DD-5 all correct; S4.9/DD-7 tension already in Codex file).
- Dependency graph: all references resolve (beyond Codex's S7.4/S7.5 omission).
- Terminology: shot-angle uniform; 対比図/しおり/歩くモード preserved; Animichi naming consistent.

## Overall

Unusually disciplined package: 76 stories, ~395 ACs at 99.7% tag rate, accurate design citations, correct DD hygiene, empty thin-list for execution-ready iterations. Weaknesses are bookkeeping decay from multi-agent backfill (train never re-synced; a few finalized behaviors with no AC; one dependency-order contradiction; one untranslated file), not design flaws. Nothing invalidates the architecture, wave structure, or iter-0/1 story designs.
