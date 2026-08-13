# Accessibility Evidence — WCAG 2.2 AA on critical journeys (#1015)

This file records how Animichi proves (and does not claim to prove) WCAG 2.2 AA
conformance on the five critical journeys: **Landing**, **login**, **Chat**,
**anime**, and **route-detail**. It deliberately separates **automated** evidence
(which runs in CI and proves absence of a class of defects) from **manual**
evidence (screen-reader / real-user judgement, which automation cannot replace).

> Automation is **not** a complete WCAG proof. axe-core and keyboard tests catch
> deterministic rule violations but cannot judge meaning, context, or screen-
> reader announcements. Conformance therefore pairs an automated gate with a
> human-verification record below.

## Scope

Critical journeys and their representative states under test:

| Journey | Route(s) | Representative state(s) exercised |
|---|---|---|
| Landing | `/` | Marketing landing (anonymous), day theme |
| Login | `/` → login modal | Magic-link dialog open, focus trap, escape restore |
| Chat | `/chat` | Cold start, history loading, streaming turn, error banner, Turnstile in dock |
| Anime | `/anime/:id` | Empty overview, outage error, loading |
| Route-detail | `/routes/:id` | Empty route, error, pending |

## How to run

```bash
# unit gates
pnpm --filter web exec vitest run tests/unit/accessibility --config vitest.config.ts

# browser gates (needs the web app running, e.g. vite dev on :3000)
E2E_WEB_BASE_URL=http://localhost:3000 pnpm --dir e2e exec playwright test web-a11y-axe.spec.ts web-a11y-keyboard.spec.ts web-a11y-states.spec.ts
```

## Automated evidence

Automated checks are the **required** pipeline gate (see AC6). They prove *no
serious/critical axe violations* and *keyboard operability* for the covered
states — they do **not** prove conformance or meaning.

### axe-core scans (`e2e/web-a11y-axe.spec.ts`)

Injects axe-core (`@axe-core/playwright`) and requires **zero** `serious`/
`critical` violations (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`
tags) on each journey. Moderate/minor findings are reported for triage but do
not fail the gate.

| Journey | Result |
|---|---|
| Landing | pass — 0 serious/critical |
| Login modal | pass — 0 serious/critical |
| Chat | pass — 0 serious/critical |
| Anime (empty) | pass — 0 serious/critical |
| Route-detail (empty) | pass — 0 serious/critical |

Violations fixed by this work:

- **Color contrast (WCAG 1.4.3)**: white text on primary teal `#19c8b9`
  (2.10:1) and on the orange CTA (2.9:1) failed; muted text on card was 4.39:1
  and the gold/chip inks ~3.7:1. Fixed by darkening the foreground inks and by
  using `--color-primary-strong` for white-text buttons/pills.

### Keyboard tests (`e2e/web-a11y-keyboard.spec.ts`, AC2)

| Behavior | Test |
|---|---|
| Skip-to-content link first tab stop, visible on focus, jumps to main | `skip-to-content link is first in tab order…` |
| Logical tab order + visible focus | `tab order stays within interactive controls…` |
| Modal initial focus on the email field | `opening the modal moves focus inside and onto the email field` |
| Modal focus trap (never leaks) | `tab traps inside the modal and never leaks…` |
| Escape closes modal, restores focus to trigger | `escape closes the modal and restores focus…` |
| Error banner reachable/retryable by Tab+Enter | `a backend-down retry banner is reachable…` |

### State accessibility (`e2e/web-a11y-states.spec.ts`, AC4)

Loading/streaming, empty, error, Turnstile and Auth states verified
understandable and keyboard-operable with `prefers-reduced-motion: reduce`.

### Unit gates (`apps/web/tests/unit/accessibility/`, AC3)

| Check | File |
|---|---|
| Reduced-motion neutralises looping chat animation | `reduced-motion.test.ts` |
| Interactive target-size floor (24px) on clickable controls | `interactive-targets.test.ts` |
| Live regions for async chat updates | `live-regions.test.tsx` |
| Semantic landmarks on the landing | `semantic-landmarks.test.tsx` |
| Accessible names on login/chat controls | `accessible-names.test.tsx` |

## Manual evidence (screen-reader / human)

> **Why manual is required:** axe cannot hear a screen reader announce a live
> region, cannot judge whether content meaning is conveyed, and cannot validate
> that focus order feels right. The rows below are a template; a human with a
> screen reader must fill them out with observed announcements and sign off.
> Automation in this repo does **not** assert these — only the deterministic rules.

### Landing
| State | What a screen reader should convey | Observed |
|---|---|---|
| Hero | Landmarks: banner, main, contentinfo; H1; search labelled | _TBD_ |
| Keyboard/skip | First Tab exposes skip link; Enter jumps to main | _TBD_ |

### Login modal
| State | What a screen reader should convey | Observed |
|---|---|---|
| Open | dialog named by auth title; focus on Email field | _TBD_ |
| Feedback | error/status announced via alert/status | _TBD_ |
| Close | Escape closes; focus returns to trigger | _TBD_ |

### Chat
| State | What a screen reader should convey | Observed |
|---|---|---|
| History loading | polite status busy | _TBD_ |
| Streaming turn | live region reports in-flight; composer disabled while busy | _TBD_ |
| Error banner | assertive alert with named retry button | _TBD_ |

### Anime / route-detail
| State | What a screen reader should convey | Observed |
|---|---|---|
| Empty | heading + empty prose (no bare spinner) | _TBD_ |
| Error | branded error heading, home/retry links | _TBD_ |

### Sign-off
| Journey | Verified by | Date | Tool |
|---|---|---|---|
| Landing | _name_ | — | — |
| Login | _name_ | — | — |
| Chat | _name_ | — | — |
| Anime | _name_ | — | — |
| Route-detail | _name_ | — | — |

## Relationship to CI

The automated axe + keyboard + state + unit gates are wired as a **required**
check in the web pipeline (AC6, `pipeline-web.yml`). The manual rows above are
the human counterpart; a PR touching a critical journey should re-record the
affected rows before merge.
