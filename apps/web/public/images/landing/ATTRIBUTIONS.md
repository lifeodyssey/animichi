# Landing Image Attributions

Copied from `frontend/public/images/landing/` (legacy frontend) at the apps/web cutover.

## suga-shrine-reality-perspective-v2.webp

- Derived from: https://commons.wikimedia.org/wiki/File:Suga_Shrine_stairs_low-angle_20161113-071158.jpg
- Author: Hisagi
- License: Creative Commons Attribution-ShareAlike 4.0 International
- License URL: https://creativecommons.org/licenses/by-sa/4.0/
- Original file: Suga Shrine stairs low-angle 20161113-071158.jpg
- Edits: perspective correction, crop, webp re-encode

## suga-shrine-anime-source.webp

- Related work: 君の名は。 (Your Name., CoMix Wave Films)
- Use: low-resolution scene reference for the anime-vs-real comparison
- License: source license not confirmed

> Removed 2026-08-22 with `MobileFoxHome`: `fox-welcome.webp` and `shrine-approach.webp`
> (the component was their only consumer) plus `fox-peek.webp`, which had already lost
> its last reference with the `.scene-card__fox` landing scene. All three were
> project-owned artwork needing no external attribution, and the originals remain in
> `docs/mockups/mobile-fox-home-assets/`.

---

## Assets added by the 2026-08 landing/splash design restore

Source of the SVG and fox artwork: the design-sync canvas
(`docs/archive/design-sync/assets/`), extracted from the Landing mockup.

> Removed 2026-08-23 with the landing page itself (`/` became a doorway to `/chat`,
> so `LandingPage` and every component under it was deleted):
>
> - `foliage-tr.svg` — `LandingDeco` was its only consumer.
> - `fox/fox-lean.svg` — `HeroSceneCard` was its only consumer.
>
> Verified by grep before deletion; the surviving files below each still have a live
> consumer, or were already unreferenced before this change and are left untouched.

## Assets restored by the 2026-08-30 direction-E fusion

- `compare/anime.jpg` and `compare/real.jpg` — restored from git history
  (`b68aca51c^`) for the rebuilt comparison slider on `/`. **The unconfirmed
  licensing note from the 2026-08-23 removal still stands**: the anime frame
  carries a visible "All rights reserved CoMix Wave Films ©" watermark and must
  be replaced or licensed before any public launch.
  - `anime.jpg`: 『秒速5センチメートル』(CoMix Wave Films) — unconfirmed.
  - `real.jpg`: real photo of the same cherry-blossom railway crossing —
    provenance carried over from the original landing; confirm on the same pass.
    Re-graded 2026-08-30 (2% right/bottom crop, brightness/contrast/saturation
    lift) so the frame holds up next to the vivid anime cut.

## Route-sample row (2026-08-30, `RouteSamples` on `/`)

- `route-uji.webp` — 宇治橋 (Uji Bridge, Kyoto). Derived from
  https://commons.wikimedia.org/wiki/File:Uji-Bridge.jpg — author 京都東,
  CC BY-SA 4.0. Edits: 16:10 crop, 880px webp re-encode.
- `route-suga.webp` — 須賀神社階段 (Suga Shrine stairs). Derived from the
  already-attributed `suga-shrine-reality-perspective-v2.webp` above
  (Hisagi, CC BY-SA 4.0). Edits: 880px webp re-encode.
- `route-sangubashi.webp` — 小田急線参宮橋1号踏切 (the 秒速5センチメートル
  crossing). Derived from
  https://commons.wikimedia.org/wiki/File:Sangubashi_kohonegawa.jpg —
  author 鋸香具師, CC0 1.0. Edits: 16:10 crop, 880px webp re-encode.

### torii.svg

- Project-owned artwork, extracted from the Landing mockup in the design-sync canvas.
- Still in use: the chat app bar's brand mark (`ChatAppBar`).
- No external attribution required.

### fox/fox-curious.svg, fox-welcome.svg, fox-cheer.svg, fox-stand.svg

- Project-owned mascot artwork (fox guide set), extracted from the design-sync canvas.
- Still in use: `fox-curious.svg` (chat app bar).
- `fox-welcome.svg` lost its consumer 2026-08-30 when the login modal dropped the
  mascot; `fox-cheer.svg` and `fox-stand.svg` have had none since before that —
  all three stay in place deliberately rather than being swept up with the deletion.
- No external attribution required.
