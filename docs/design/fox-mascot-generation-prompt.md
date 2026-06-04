# Fox Mascot — Image Generation Prompt (De-AI Edition)

A reusable, model-agnostic brief for generating the Seichijunrei guide-fox mascot,
engineered specifically to **strip the "AI-generated" look**. It encodes the
failure modes of every earlier attempt (floating icons, baked-in text, mushy held
photos, airbrush plastic shading, character drift, the generic-Dribbble-mascot
feel) and the techniques that defeat each one.

**Concept anchor:** the wayfinding inari fox from *Ghost of Tsushima* — an elegant,
slightly mystical fox that leads pilgrims to sacred sites — rendered cute and cozy
in the 動森キャンプ (Animal Crossing × Yuru Camp) warmth of the product. The fox
is a *guide to sacred places*, which is exactly what this product is.

---

## 0. Read this first — why generations look "AI", and the levers that fix it

Text prompting alone cannot fully scrub the AI look, because the look IS the
model's default distribution. You remove it by **forcing the model out of that
default with hard constraints**, not by adding adjectives. The four levers below,
in order of impact:

1. **Anchor a real physical medium.** This does ~80% of the work. A diffusion
   model rendering "cute mascot" lands in plastic-3D-render space. The same model
   asked for "a 3-color screen print" or "gouache on watercolor paper" or "a
   woodblock ema votive plaque" is forced into a flatter, hand-made distribution
   it cannot airbrush. Name the medium and demand its real artifacts.
2. **Impose hard flat constraints.** "Flat colors, no gradients", "limited
   5-color palette", "one single hard-edged cel shadow maximum", "bold even ink
   outline of uniform weight". Constraints read as intentional design; the absence
   of constraints reads as AI.
3. **Drop the words that summon the AI cluster.** Never say *cute mascot, 3D,
   render, octane, highly detailed, intricate, hyperrealistic, glowing, magical
   sparkles*. Say instead *illustration, print, charm, woodcut, folk craft,
   editorial, flat, limited palette*. Word choice steers which training cluster
   you land in.
4. **Direct the composition and light.** Off-center placement, strong readable
   silhouette, flat even light, deliberate negative space. AI defaults to a
   dead-center symmetrical hero shot under soft studio lighting with ambient glow;
   asking for the opposite reads as a designed piece.

### The AI-tell taxonomy (what we are actively banning)

| # | Tell | Why it screams "AI" | Counter |
|---|------|---------------------|---------|
| 1 | Plastic airbrush gradients + ambient occlusion everywhere | The default render look | "flat colors, no gradients, no soft shading" |
| 2 | Rim light, bloom, glow, magic aura | Diffusion loves drama lighting | "flat even lighting, no glow, no rim light" |
| 3 | Floating particles, sparkles, bokeh dust | Fills empty space automatically | "no particles, no sparkles, clean empty background" |
| 4 | Decorative confetti — orbiting icons, leaves, orbs | Trained on busy mascot art | "subject only, nothing floating around it" |
| 5 | Dead-center symmetry, generic hero framing | The default composition | "off-center, dynamic, intentional negative space" |
| 6 | Over-rendered micro-detail noise | More detail = more "AI" | "minimal detail, large simple shapes, restraint" |
| 7 | Mushy hands, incoherent held objects, fake text | Diffusion can't keep small structure | "empty paws, holding nothing, no text anywhere" |
| 8 | Corporate Dribbble-mascot proportions + gradient teal/orange | The single most "AI mascot" signal | drop "mascot"; anchor a craft medium |
| 9 | Uniform fake grain/texture overlay | A filter slapped on top | demand the *medium's real* texture only |
| 10 | Painterly faux-linework instead of clean ink | Approximates lines, never commits | "bold clean ink outline, uniform weight" |
| 11 | Over-saturated 8-color blends | No palette discipline | "limited palette, max 5 flat colors" |

---

## 1. Style lanes — pick ONE (each is strongly anti-AI; lane choice is the look)

The medium is the style. Generate the same fox in your chosen lane; do not mix.

- **Lane A — Folk-craft charm (recommended: cute + warm + least AI).**
  A flat, screen-printed Japanese folk toy. Think *hariko* papier-mâché Inari fox
  or a *kokeshi*-adjacent craft charm: simple bold shapes, 4-5 flat colors, a
  single hard cel shadow, thick warm-brown ink outline, visible slight
  screen-print misregistration and matte paper grain. Cute and rounded but clearly
  handmade, not rendered.
- **Lane B — Ema woodblock (most culturally on-theme, more austere).**
  An Inari shrine *ema* votive plaque / ukiyo-e woodblock fox: flat ink areas,
  visible carved line, limited washi-paper palette, gentle imperfection. Deeply
  fitting for a pilgrimage product; less "cute", more "sacred guide".
- **Lane C — Mid-century flat (designy, Charley-Harper-geometric).**
  Reduced to confident geometric shapes, 4 flat colors, no outline, shapes define
  form. Very anti-AI through pure reduction; reads editorial, slightly less warm.

Default to **Lane A** unless you want the woodblock direction.

---

## 2. Master prompt (Lane A — character + medium; reuse as the prefix)

```
A flat screen-printed folk illustration of a single red fox guide charm,
in the spirit of a Japanese hariko papier-mache Inari fox and the wayfinding
fox of Ghost of Tsushima: an elegant little fox that leads pilgrims to shrines,
drawn cute, rounded and warm. Hand-made print look — flat solid colors with one
single hard-edged cel shadow per area, a bold even warm-brown ink outline of
uniform weight, a limited five-color palette, matte paper grain and the faint
misregistration of real screen printing. Large calm amber eyes with one small
highlight, a pointed snout, a big fluffy tail with a cream tip, a tufted cream
chest, black socks on all four legs and black ear-backs, wearing a small teal
travel scarf. Restrained: large simple shapes, minimal detail, strong readable
silhouette, generous empty space. Centered-but-slightly-turned, full body, flat
even lighting, plain flat off-white paper background, a single soft contact
shadow under the paws.
```

## 3. Palette (append to lock colors — five flat colors, no blends)

```
Limited five-color flat palette, no gradients: fox orange #e57e35, cream
#fdf5e6, black markings #3a2c22, teal scarf #19c8b9, warm brown ink outline
#5e4633. One darker orange #c4631f allowed only as the single cel shadow.
Warm cream-and-brown world, no cold colors, no neon, no pastel haze.
```

## 4. Negative prompt (the full ban list — paste verbatim)

```
3D render, octane, blender, plastic, glossy, airbrush, soft gradient, gradient
mesh, ambient occlusion, rim light, bloom, glow, lens flare, magical aura,
sparkles, particles, bokeh, dust, confetti, floating icons, orbiting leaves,
compass orb, map scroll, location pins, held objects, holding anything, text,
letters, numbers, captions, watermark, signature, logo, busy background,
scenery, gradient background, vignette, drop-shadow halo, sticker die-cut
outline, hyperrealistic, photorealistic, photo, highly detailed, intricate,
ornate, over-rendered, noisy detail, fur fibers, individual hairs, cute mascot
logo, corporate mascot, dribbble mascot, kawaii sticker pack, extra limbs,
deformed paws, multiple foxes, cat face, flat cat face, muddy colors,
oversaturated, neon, eight colors, rainbow
```

---

## 5. Technical & consistency rules

- **Generate a model sheet FIRST, always.** Append to the master prompt:
  `model sheet, the same fox in nine poses on one sheet, consistent design,
  flat reference turnaround`. Lock the character and the print look from one
  sheet, then upscale each pose. This is the single biggest lever for keeping all
  seven states on-model and on-style.
- **Background:** flat solid off-white `#faf8f3`, NOT transparent. A clean solid
  matte backdrop cuts out perfectly; model transparency is unreliable and leaves
  halos.
- **Framing:** square `1:1`, full body, generous margin, highest resolution.
- **Midjourney:** add
  `--ar 1:1 --style raw --no 3d, render, gradient, glow, sparkles, text, background`.
  `--style raw` strips Midjourney's decorative defaults; the `--no` list is your
  front-line de-AI filter.
- **DALL·E / Codex / SD:** use sections 2 + 3 as the prompt and phrase section 4
  as "Avoid: ...". For SD, set a low-ish CFG (5-7) and a flat/anime/lineart LoRA
  if available; high CFG amplifies the AI gloss.
- **Nuclear option for zero AI flavor:** generate in Lane A, then **vector-trace
  the winner** (Illustrator Image Trace / `vtracer`) and flatten to the five-color
  palette. The trace discards all residual airbrush noise and yields crisp,
  on-brand, infinitely scalable SVG. Hand this traced SVG back for integration.

---

## 6. Pose set (replace the "Restrained: ..." sentence per state)

| State | Pose phrase | Used on |
|-------|-------------|---------|
| `welcome` | sitting upright, one paw raised in a friendly wave, calm welcoming smile | Hero greeting |
| `guide` | standing, looking back over its shoulder, one paw pointing the way forward | How It Works |
| `traveler` | walking mid-stride, a tiny simple travel pack on its back, eager | Popular Routes banner |
| `thinking` | sitting, one paw to its chin, looking up, a single small thought mark | Loading state |
| `cheer` | both front paws raised, eyes closed and happy, a joyful hop | Route saved / success |
| `curious` | sitting, head tilted, ears perked, wide curious eyes | Empty state |
| `oops` | sitting small, ears drooped, an apologetic look, one paw at its cheek | Error state |

Keep every other word of the master prompt identical across all seven so the
character and print look stay locked.

---

## 7. Self-check rubric — score each generation before accepting

Reject and re-roll if any answer is "yes":

- Does it have ANY gradient, glow, rim light, or soft airbrush shading?
- Is there anything floating around the fox (sparkles, leaves, icons, particles)?
- Is it holding anything, or is there any text/letterform anywhere?
- Are the colors more than the five (plus one shadow)?
- Does the outline vary in weight or look painterly rather than a clean ink line?
- Does it read as a glossy 3D corporate mascot rather than a flat printed charm?
- Could a stranger say "an AI made this" in under two seconds?

A keeper is flat, limited, hand-made-looking, holds nothing, floats nothing, and
reads as a *printed folk charm of a guide fox* — refined through restraint, not
through detail.

---

## 8. Delivery to integration

After generating, hand the images (or the vector-traced SVG) back for:
solid-background cutout to transparent WebP (or direct SVG import), wiring into the
`FoxMascot` component, a Storybook showcase of all seven states, and replacement
of the current hero fox.
