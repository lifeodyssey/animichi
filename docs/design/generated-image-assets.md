# Generated Image Assets

This document tracks generated design images for the SSR landing-page redesign. Keep it updated whenever a new generated image is added to the repository so that future implementation work can understand what each image represents.

## Current Direction

- Product surface: landing page for an AI anime pilgrimage travel planner.
- Visual direction: cozy Japanese travel, soft paper texture, muted teal, warm fox orange, soft coral, pale sky blue, small green accents.
- Mascot direction: original fox guide. Do not copy or closely resemble Animal Crossing, Nintendo, anime characters, or any existing mascot. Mascot source images should not include embedded text; names and labels belong in the product UI/i18n layer.
- Header direction: no traditional header on the landing page. Keep only a compact top-right login/user entry.
- Business content direction: use real product functions and app data instead of generic travel labels.

## Asset Directory

The latest mascot images are stored under:

`frontend/public/images/landing/fox-guide-v2/`

Earlier concept images are stored under:

`frontend/public/images/landing/fox-guide-v1/`

## Fox Mascot Exploration V2

These are the preferred mascot assets for implementation because they contain no embedded text, captions, letters, or labels.

| File | Meaning | Intended use |
| --- | --- | --- |
| `fox-variant-sheet.png` | Six-way no-text overview of the original fox guide directions. | Review board only; not intended as a production UI asset. |
| `fox-a-city-guide.png` | Clever city guide fox with camera and teal scarf. | Landing helper, city-route empty states, search suggestions. |
| `fox-b-shrine-route.png` | Gentle shrine-route fox with map scroll and charm. | Pilgrimage route explanation, shrine/stair comparison moments. |
| `fox-c-ai-navigator.png` | More tech-forward AI navigator fox with map-pin badge. | AI planning, route generation, loading or assistant states. |
| `fox-d-backpack-traveler.png` | Backpack traveler fox with ticket and notebook. | Day-trip planning, route cards, itinerary states. |
| `fox-e-scene-compare.png` | Fox holding real/anime comparison frames. | Scene comparison module and screenshot-to-location flows. |
| `fox-f-icon-mark.png` | Simplified icon-like fox mark, tail as route line. | Logo mark, small badge, favicon/app icon exploration. |

Recommended next pick: use `fox-c-ai-navigator.png` or `fox-e-scene-compare.png` for the landing-page hero. Use `fox-f-icon-mark.png` only for tiny UI surfaces.

## Fox Mascot Exploration V1

| File | Meaning | Intended use |
| --- | --- | --- |
| `fox-variant-sheet.png` | First six-way exploration sheet for the original fox guide. | Review board only; not intended as a production UI asset. |
| `fox-a-city-guide.png` | Clever city guide fox with camera and teal scarf. | Landing helper, city-route empty states, search suggestions. |
| `fox-b-shrine-route.png` | Gentle shrine-route fox with map scroll and charm. | Pilgrimage route explanation, shrine/stair comparison moments. |
| `fox-c-ai-navigator.png` | More tech-forward AI navigator fox with map-pin badge. | AI planning, route generation, loading or assistant states. |
| `fox-d-backpack-traveler.png` | Backpack traveler fox with ticket and notebook. | Day-trip planning, route cards, itinerary states. |
| `fox-e-scene-compare.png` | Fox holding real/anime comparison frames. | Scene comparison module and screenshot-to-location flows. |
| `fox-f-icon-mark.png` | Simplified icon-like fox mark, tail as route line. | Logo mark, small badge, favicon/app icon exploration. |

V1 is kept for process history. Prefer V2 for product implementation because V1 includes embedded labels.

## Landing Page Concept

| File | Meaning | Intended use |
| --- | --- | --- |
| `landing-page-fox-guide-full.png` | Full long landing-page concept with no header, top-right login pill, hero search, real/anime comparison card, feature entries, and popular pilgrimage routes. | Design reference for rebuilding `frontend/components/auth/LandingPage.tsx`. |

Key ideas captured in this concept:

- Do not use a full navigation header for the first landing iteration.
- Keep the first viewport calm: left search intent, right comparison visual.
- Let the next section peek below the fold so the page clearly scrolls.
- Keep the fox small and functional; it should guide the product, not become the product.
- Popular route examples should use existing app-like data:
  - `響け！ユーフォニアム` — `156 spots · 宇治市`
  - `君の名は。` — `89 spots · 新宿/飛騨`
  - `天気の子` — `72 spots · 東京`
  - `ぼっち・ざ・ろっく！` — `45 spots · 下北沢`

## Component Concepts

| File | Meaning | Intended use |
| --- | --- | --- |
| `component-login-dropdown.png` | Compact top-right login/user dropdown for no-header landing page. Includes logged-out and logged-in states. | Login entry, user menu, history/conversation access direction. |
| `component-hero-search.png` | Hero headline, subtitle, prompt input, CTA, and suggestion chips with small fox helper. | Landing hero search and onboarding prompt. |
| `component-scene-comparison.png` | Real/anime comparison card with draggable divider and small fox comparison helper. | Hero visual, image comparison component, screenshot-to-location pitch. |
| `component-feature-entry.png` | Four business feature tiles: scene recognition, route generation, comparison check-in, saved itineraries. | Landing feature section and product capability summary. |
| `component-popular-routes.png` | Popular pilgrimage route cards using current app-like series/location data. | Landing route gallery below the hero. |

## Implementation Notes

- Generated concept text may need manual correction in code; use the images for layout, visual density, color, and hierarchy, not as final copy.
- Do not embed localized text in mascot assets. Keep all text in React components and dictionary files.
- Keep mascot usage sparse. Prefer one primary fox in the hero and small abstract fox-tail/map-pin accents elsewhere.
- Do not introduce copied animal characters from external games or animation properties.
- If these assets are later used directly in production UI, add alt text that describes the function rather than the visual style.
