# Sprite Pipeline 2026 — what to use now, and how to migrate

*Researched 2026-08-30. The current pipeline (one 5×6 reference sheet from a general
image model → checkerboard removal → connected-component crops → anchor metadata) was
state of the art in 2024. It is the root cause of the inconsistency: every character is
one generation, so any cell the model fumbles is baked in, and cross-sheet identity
(punch sheet vs base sheet) depends entirely on prompt luck.*

## The landscape, one line each

- **[PixelLab.ai](https://www.pixellab.ai/)** — pixel-art specialist API: skeleton-based
  and text-prompted character animation, 4/8-direction rotations, inpainting that
  understands the source sprite. Purpose-built for exactly our asset contract.
- **[Retro Diffusion](https://aidirectory.com/retro-diffusion)** — model trained
  explicitly on multi-frame sprite-sheet data; RD Animation makes sheets directly.
  API pricing ≈ $0.015/image (Fast) to $0.18 (Pro); animations $0.07–$0.25. Per
  [Ludo.ai's 2026 comparison](https://ludo.ai/compare/best-ai-sprite-generators),
  trained-on-sheets models beat reference-pinning on identity consistency.
- **[FLUX.1 Kontext](https://flick.art/blog/img2img-consistent-character/flux)** —
  reference-conditioned *editing*: one source image + "same character, mid punch" →
  new pose, no LoRA training. The general-purpose consistency workhorse; open dev
  weights run locally in ComfyUI.
- **Video-gen → frames** ([workflow](https://www.layrkits.com/guides/sprite-sheet),
  [Wan sprite workflow on Civitai](https://civitai.com/models/2425415/sprite-sheet-generator)) —
  describe the motion ("walk cycle", "uppercut"), let Wan/Kling/Seedance render a
  2s clip from the character reference, sample N frames, downscale/quantize to pixel
  art, auto-stitch. Smoothest animation of any approach because temporal coherence is
  the video model's whole job.

## Recommended pipeline for this repo

Keep the ports (`imageGenerator`, `spriteNormalizer`); swap what flows through them.

1. **Identity anchor (once per character):** generate ONE hero sprite (single pose,
   not a grid) with the current OpenAI adapter or Retro Diffusion. Human-approve it in
   the admin. This becomes `source/<id>_anchor.png` — the only place taste enters.
2. **Rows via reference-conditioned generation (per move row):** for each animation
   row, call **PixelLab's animation API** with the anchor as the character reference
   and the row's action prompt (we already generate per-move row prompts — commit
   `60ac7dc`). Fallback adapter: **FLUX Kontext** ("same character, frame 3 of a
   heavy kick, side view, feet on baseline") frame by frame. Both are new
   `imageGenerator` adapters; env-var selection already exists
   (`IMAGE_GENERATOR_PROVIDER=pixellab|kontext|openai`).
3. **Smooth cycles via video sampling (idle/walk only):** idle breathing and walk
   cycles benefit most from temporal coherence — render a 2s loop with Wan/Kling from
   the anchor, sample 6 frames, pixel-quantize. Attack rows stay on step 2 (video
   models overshoot fast motions and push subjects out of frame —
   [known Kling failure](https://sorceress.games/blog/tune-the-best-ai-animation-generator-honest-2026-test)).
4. **Normalization stays ours, plus a rejection gate:** keep the contour normalizer
   (component detection, anchor metadata, variable frames — it's good). Add an
   **identity QA gate** in `fighterQa`: palette histogram distance + silhouette IoU
   between each frame and the anchor; auto-reject and regenerate outliers instead of
   shipping them. This converts "very inconsistent" from a vibe into a threshold.
5. **Per-character cost:** ~11 rows × 6 frames ≈ 66 frames. PixelLab/RD pricing lands
   this around **$1.50–$4 per character**; Kontext via a hosted endpoint ~$0.03/frame
   ≈ $2. Cheap enough to regenerate rejected frames freely.

**Why not "one big grid" anymore:** single-grid generation keeps palette consistent
*within* a sheet ([the classic trick](https://freegamesprites.com/en/news/ai-pixel-art-generation-2026-tools-and-workflows))
but caps quality at the model's worst cell and can never add a row later. Anchor +
per-row reference generation makes rows independently regenerable — which is what
"expansions" (new specials, new projectiles, grab animations) actually require.

## Migration path

1. Add `createPixellabAdapter.js` (imageGenerator port) + smoke test. Anchor-conditioned
   row generation behind `IMAGE_GENERATOR_PROVIDER=pixellab`.
2. Add the identity QA gate to `fighterQa` (pure image math, no new model needed).
3. Regenerate ONE existing fighter's rows against their current base frame as anchor;
   A/B in the gym before touching the roster.
4. Only then consider the video-sampling adapter for idle/walk rows.

Alternatives, one line each: Retro Diffusion end-to-end (cheapest, strongest pixel
identity, less pose control than skeleton-based PixelLab); local ComfyUI Kontext
(free, private, slowest to operate); keep current single-sheet flow and just add the
QA gate (smallest change, fixes rejection but not identity).
