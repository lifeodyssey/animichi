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
> - `compare/anime.jpg` and `compare/real.jpg` — the `ComparisonSlider` was their only
>   consumer. Both carried **unconfirmed licensing** (the anime frame even carried a
>   visible "All rights reserved CoMix Wave Films ©" watermark and was flagged
>   "resolve before any public launch"), so their removal also retires that risk.
> - `foliage-tr.svg` — `LandingDeco` was its only consumer.
> - `fox/fox-lean.svg` — `HeroSceneCard` was its only consumer.
>
> Verified by grep before deletion; the surviving files below each still have a live
> consumer, or were already unreferenced before this change and are left untouched.

### torii.svg

- Project-owned artwork, extracted from the Landing mockup in the design-sync canvas.
- Still in use: the chat app bar's brand mark (`ChatAppBar`).
- No external attribution required.

### fox/fox-curious.svg, fox-welcome.svg, fox-cheer.svg, fox-stand.svg

- Project-owned mascot artwork (fox guide set), extracted from the design-sync canvas.
- Still in use: `fox-curious.svg` (chat app bar), `fox-welcome.svg` (login modal).
- `fox-cheer.svg` and `fox-stand.svg` have had no consumer since before this change —
  left in place deliberately rather than swept up with the landing deletion.
- No external attribution required.
