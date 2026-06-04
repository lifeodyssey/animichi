# Hero Backdrop — Image Generation Prompt (De-AI Edition)

A reusable, model-agnostic brief for generating the homepage hero **background
wash** — the soft, warm, atmospheric image that sits faintly behind the first
screen. Engineered specifically to **strip the "AI-generated" look** that ruined
the previous backdrop (`hero-background.png`), which read as a generic
over-soft AI anime wallpaper.

**Where this image lives in the design:** a *faint background wash* behind the
hero content (left headline + search column, right anime↔real comparison card).
It is NOT a foreground hero. It must be calm, low-contrast, and mostly empty in
the upper-center so text and cards sit cleanly on top. Atmosphere, not subject.

**Save the generated image to:**
`frontend/public/images/landing/hero-backdrop-v2.png`

Once saved, it renders here:

![hero backdrop v2](../../frontend/public/images/landing/hero-backdrop-v2.png)

---

## 0. Read first — why AI landscapes look "AI", and the levers that fix it

The same truth as the fox brief: you don't remove the AI look by adding
adjectives, you remove it by **forcing the model out of its default
distribution with a real medium and hard constraints**. For *landscapes* the
default failure cluster is the over-saturated, over-detailed, HDR "anime
wallpaper" — and the four levers below, in order of impact, defeat it.

1. **Anchor a real painting tradition, not "anime background".** A diffusion
   model asked for an "anime landscape" lands in the saturated-wallpaper
   cluster. The same model asked for **hand-painted anime background art
   (haikei-ga / 背景画) in the tradition of Studio Ghibli's Kazuo Oga or Makoto
   Shinkai's background painters, in gouache and soft digital brushwork** is
   forced into a hand-made, painterly distribution it cannot HDR-plasticize.
   Name the craft and demand its real artifacts (visible brush texture, paper
   tooth, hand-mixed color).
2. **Impose hard atmosphere constraints.** "Low contrast, soft, hazy, muted,
   limited warm palette, golden-hour, lots of open sky." A backdrop that's calm
   reads as intentional; a backdrop that's loud and detailed reads as AI showing
   off.
3. **Drop the words that summon the AI cluster.** Never say *4k, 8k, ultra
   detailed, hyperdetailed, octane, unreal engine, cinematic, masterpiece,
   trending, vibrant, stunning, epic.* Say instead *hand-painted, gouache,
   background art, muted, soft, calm, painterly, limited palette.*
4. **Direct the composition for its job.** It is a *wash behind text*: push all
   detail to the lower third and edges, keep the upper-center as open warm sky
   with nothing happening, keep contrast low so overlaid type stays legible.

### The AI-tell taxonomy for landscapes (what we are actively banning)

| # | Tell | Why it screams "AI" | Counter |
|---|------|---------------------|---------|
| 1 | Over-saturated HDR color | The default "vibrant anime" look | "muted, limited warm palette, low saturation" |
| 2 | Fake lens flare, bloom, god-rays everywhere | Diffusion loves drama light | "soft even golden light, no lens flare, no bloom" |
| 3 | Over-rendered micro-detail (every leaf, every tile) | More detail = more "AI" | "soft, painterly, simplified shapes, restraint" |
| 4 | Melty / impossible architecture and perspective | Diffusion can't hold structure | "simple, plausible Japanese hillside buildings" |
| 5 | Plastic airbrush gradients in the sky | The render look | "gouache brush texture, hand-mixed sky, visible strokes" |
| 6 | Generic centered wallpaper composition | Trained on wallpapers | "off-center, detail to the lower third, open upper sky" |
| 7 | Floating particles, glowing dust, sparkles | Fills empty space | "no particles, no glow, clean calm air" |
| 8 | Too-perfect symmetry / postcard framing | The default frame | "casual, slightly mundane real street, asymmetric" |
| 9 | Neon sunset / unreal sky colors | Over-dramatized | "warm amber and cream, gentle, believable late afternoon" |
| 10 | Uniform sharpness everywhere | No painterly focus | "soft distance haze, looser background, calmer center" |

---

## 1. Style lanes — pick ONE (each is strongly anti-AI; the lane IS the look)

- **Lane A — Ghibli background art (recommended: warmest, most hand-made).**
  In the tradition of Studio Ghibli's Kazuo Oga background paintings: gouache,
  visible brushwork, soft natural light, gentle muted color, lived-in ordinary
  Japanese scenery (a sloping town street, hydrangeas, a small shrine). Cozy,
  hand-painted, never glossy.
- **Lane B — Shinkai haikei (more luminous, a touch more contrast).**
  In the tradition of Makoto Shinkai's background painters: layered atmospheric
  haze, warm light, more sky drama — but still painterly, NOT photoreal. Push
  the muting hard or it drifts toward the AI-wallpaper cluster.
- **Lane C — Plein-air gouache sketch (most editorial / least AI, least anime).**
  A loose travel-sketchbook gouache study of the same scene: visible paper,
  limited 5-color palette, simplified shapes. Reads as a real painting; pairs
  beautifully with the journal motif, slightly less "anime".

Default to **Lane A** for the cozy 動森キャンプ warmth. Use Lane C if any AI
softness still bothers you — a flat gouache sketch is nearly impossible to
mistake for AI.

---

## 2. Master prompt (Lane A — paste, then append §3 + §4)

```
A hand-painted anime background painting (haikei-ga) of a quiet, ordinary
Japanese hillside shrine town in warm late-afternoon golden-hour light, in the
tradition of Studio Ghibli background art by Kazuo Oga — painted in gouache with
soft visible brushwork and gentle paper texture, hand-mixed muted color, NOT
photorealistic and NOT a 3D render. A gentle sloping residential street with
worn stone steps descending, a small weathered torii gate and a stone lantern
to one side, blue hydrangeas along a low wall, casual power lines crossing the
sky, modest low rooftops fading into soft warm haze toward a distant town.
Calm, lived-in, ordinary, a little melancholy and nostalgic. Soft even light,
low contrast, lots of open warm hazy sky filling the upper and central area
with almost nothing happening there, the gentle detail kept to the lower third
and the right edge. Painterly, restrained, hand-made.
```

## 3. Palette (append to lock color)

```
Muted warm palette: cream and pale ochre sky, soft amber light, dusty sage and
olive greens, faded terracotta and grey-blue rooftops, gentle dusty-rose
hydrangeas, warm brown stone. Low saturation, golden-hour warmth throughout.
No cold blue dominance, no neon, no oversaturation, no high-contrast.
```

## 4. Negative prompt (ban the landscape AI tells, verbatim)

```
3D render, octane, unreal engine, cinematic, photorealistic, photo, HDR, 4k,
8k, ultra detailed, hyperdetailed, masterpiece, trending on artstation, vibrant,
stunning, epic, lens flare, sun flare, god rays, bloom, glow, glowing particles,
floating dust, sparkles, oversaturated, neon, electric colors, sharp everywhere,
glossy, plastic, airbrush, smooth gradient sky, melted architecture, warped
perspective, symmetrical postcard composition, busy center, characters, people,
crowds, text, signage with letters, watermark, logo, UI, frame, border
```

---

## 5. Composition & technical rules (this is a backdrop, not a hero)

- **Aspect ratio:** wide — `16:9` minimum, `21:9` is better for a full-bleed
  page background. High resolution.
- **Negative space is mandatory.** The upper ~60% (sky / haze) must be calm and
  near-empty so the headline, search, and comparison card read on top. Put the
  street, steps, torii, and hydrangeas in the **lower third and toward the right
  edge** (the left is where the headline column sits).
- **Low contrast on purpose.** It will be faded to ~25–40% opacity over a cream
  page and possibly given a warm scrim. Generate it already soft; do not fight
  that with punchy contrast.
- **Midjourney:** add `--ar 21:9 --style raw --no 3d, render, hdr, lens flare,
  glow, sparkles, people, text, neon`. `--style raw` strips MJ's drama defaults.
- **DALL·E / Codex / SD:** use §2 + §3 as the prompt and phrase §4 as "Avoid:".
  For SD keep CFG low (5–7); high CFG amplifies the AI gloss.
- **Generate 3–4, pick the calmest.** The keeper is the one you could almost
  ignore — atmosphere, not spectacle.

---

## 6. Self-check rubric — reject and re-roll if any answer is "yes"

- Does the sky have plastic smooth gradients instead of gouache brush texture?
- Is there any lens flare, bloom, god-ray, glow, or floating particle?
- Is the color saturated / "vibrant" rather than muted and warm?
- Is the center busy, or is the upper-center open enough for text to sit on it?
- Does the architecture melt or the perspective warp anywhere?
- Could a stranger say "an AI made this wallpaper" in under two seconds?

A keeper is **calm, muted, hand-painted, low-contrast, mostly-open warm sky,
detail pushed low and right** — a quiet painted backdrop you could read text
over, not an anime wallpaper.

---

## 7. Delivery & integration

1. Save the winner to `frontend/public/images/landing/hero-backdrop-v2.png`
   (this doc embeds it above for review).
2. Hand it back. It will be used as a **faint background wash** on the B layout:
   full-bleed, faded to ~25–40% opacity over the cream page, optionally with a
   soft warm scrim — so it contributes atmosphere and warmth without competing
   with the headline column or the anime↔real comparison card.
3. If any residual AI softness shows even at low opacity, the fallback is the
   §5 "nuclear option" mindset: drop opacity further / blur slightly / switch to
   Lane C gouache sketch, which carries almost no AI signal.
