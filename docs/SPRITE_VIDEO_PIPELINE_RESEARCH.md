# Clean sprite animation: research and proposed pipeline

Research checked September 15, 2026. This is a recommendation and benchmark design, not a claim that a model has already passed our game-quality bar. No paid generations, model training, provider changes, or credential changes were performed for this research. Gemini is excluded.

## Recommendation

Keep the proposed split: image generation establishes the character; video can supply coherent movement. Add a third, explicit source of truth: **a reusable motion specification with authored timing and a driving performance**. For walking, jumping, and attacks, the scalable unit should be a tested action template applied to many characters, not a fresh prose request for every character/action pair.

The strongest next experiment is controlled motion transfer into an approved reference image, followed by deterministic sprite extraction and human acceptance in the game. Benchmark that against our existing image-frame approach and a simple rig-rendered control. Do not commit to video-only or start fine-tuning yet. Video coherence is useful, but it does not guarantee planted feet, a clean alpha edge, exact impact timing, or deliberately placed pixels.

For a large roster, my architectural preference is a hybrid: reusable rig/pose motion for common actions; reference-conditioned video for character appearance and secondary motion; artist correction for key poses; separately generated or procedural VFX. The benchmark must decide how much generated video is usable without repainting.

## What people can actually demonstrate

The evidence supports feasibility, not a universal production recipe:

| Evidence | What is demonstrated or documented | What it does not establish |
| --- | --- | --- |
| [ComfyUI 2D Character Pipeline](https://github.com/mor-o/comfyui-2d-character-pipeline) | Published workflows and sample assets: Wan2.2 I2V → BiRefNet background removal → RGBA sheets; separate cosmetic passes. The author reports validation on idle, walking, and in-air animations for **one base character**. | Generalization to a large roster, strict pixel art, fighting-game contact timing, or low correction cost. |
| [sprite-gen video workflow](https://github.com/aldegad/sprite-gen/blob/main/docs/video-pipeline.md) | First-hand implementation notes on action-specific canvas sizes, full-frame extraction, actual loop-period detection, and one-shot detection. Its documented tuning set began with 15 loops from one biped, then additional quadruped/blob cases. | A broad benchmark. The real subjects are not included; published tests use synthetic fixtures. Thresholds should not be copied as universal truths. |
| [Sprite Sheet Generation using a Diffusion Model, Wong/Volino](https://marcovolino.github.io/docs/papers/2025-wong-cvmp.pdf) | A small research comparison using pose-conditioned animation. Generating detailed motion and pixelating afterward outperformed pixelating the input first on their reported metrics. Training used 845 frames across 94 actions and 30,000 steps. | Authentic hand-authored pixel clusters or production fighting sprites. This is a one-page study using portrait-derived imagery and deterministic pixelation, not evidence that an action-figure render becomes good pixel art after downsampling. |
| [Sprite Sheet Diffusion](https://arxiv.org/abs/2412.03685), [author code](https://github.com/chenganhsieh/Sprite-Sheet-Diffusion) | Dedicated research on reference/pose-conditioned sprite animation, with training code. | A maintained turnkey replacement for the current CMS or measured throughput on this roster. |
| [Blender SpriteSheetMaker](https://github.com/ManasMakde/SpriteSheetMaker/), [blender-spritesheets](https://github.com/theloneplant/blender-spritesheets) | Reproducible tools for turning authored 3D animations into sprite sheets, including orthographic rendering and metadata. | Automatic character modeling or an attractive pixel-art style without art direction. |

The useful common pattern is that clean results come from **controlling the source motion and doing explicit postprocessing**. A beautiful demo video is a much weaker test than an alpha sprite looping at native size while its hitbox is visible.

## Initial shortlist: three lanes

These are ranked by usefulness for this project, not by an unmeasured claim of image quality.

1. **Kling V3 Standard Motion Control through fal** — the first hosted comparison for authored walk/jump/strike motion. It accepts a character image plus driving video. Its schema recommends a realistic, unobstructed full-body or upper-body performer for the driver, so start with a clean human performance; a stylized rig driver is a separate test. Set sound off. The documented `character_orientation="video"` follows the driving orientation and is intended for complex motion. Pixel-art fidelity is unproven until our benchmark. [API schema](https://fal.ai/models/fal-ai/kling-video/v3/standard/motion-control/api)

2. **MiniMax H3 reference-to-video** — the comparison using the integration already present. The official API supports a reference image and `reference_video`, as well as separate first/last-frame modes. Our adapter currently sends identity references but no driving video; it therefore does not exercise the capability most relevant to consistent reusable action timing. Identical start/end images may help a loop boundary, but do not constrain the intervening gait or its velocity. [Official generation guide](https://platform.minimax.io/docs/guides/video-generation)

3. **An authored rig rendered directly to sprites** — the deterministic quality/control lane. Use one simple humanoid, one fixed orthographic camera, flat materials, controlled lighting, native RGBA, and the same motion driver. Render at a deliberately chosen pixel scale. This establishes what stable anchors, exact contact, and reusable motion can achieve without generative uncertainty. A 2D cutout rig is cheaper for limited facing changes; 3D is more flexible for twists and kicks, but both require correction to achieve a hand-drawn look. [Concrete Blender exporter](https://github.com/ManasMakde/SpriteSheetMaker/)

Use the existing fal Klein frame generator as a fourth **baseline already in the project**, rather than adding another provider. It establishes whether video really improves acceptance and motion over six independent images.

If the controlled-video lanes win, the next self-hosted candidate is **Wan2.2-Animate**, whose official implementation takes a character image and driving video, includes retargeting preprocessing, and publishes inference code/weights. Generic I2V and Animate are different checkpoints. The project explicitly discourages applying generic Wan2.2 LoRAs to Animate because the weights differ. Its Apache-2.0 repository is a more straightforward starting point for a deployment investigation than assuming every downloadable video model is unrestricted. Check each actual weight/dependency license when selecting a deployment. [Official Wan repository](https://github.com/Wan-Video/Wan2.2)

Two research candidates stay off the critical path: [Wan-Animate-2](https://humanaigc.github.io/wan-animate-2/) reports direct driving-video conditioning and viewpoint control, but its project page still describes a future base-weight release; deployment availability needs separate verification. [VACE](https://github.com/ali-vilab/VACE) exposes reference generation and masked video editing, which may be useful for controlled costume/prop changes after motion is stable. Neither is a demonstrated pixel-sprite winner here.

## What the current repository already has — and where it loses motion

The existing adapters, retained source video, manifest, and export path are useful foundations. They need a richer intermediate asset than a six-cell PNG:

| Current behavior | Consequence | Proposed change |
| --- | --- | --- |
| `minimaxH3SpriteSheetGeneratorAdapter.js` retains the MP4 but samples exactly six uniformly spaced frames with `fps=6/duration`. | A short punch can occur between samples; repeated idle frames may dominate. More source-video FPS cannot fix discarded contact frames. | Decode every source frame with timestamps, identify the useful action interval, then select meaningful poses. Keep six-frame output as a compatibility export. |
| All H3 actions receive anticipation/recovery wording. | Walks and loops inherit an attack-shaped instruction. | Separate loop, one-shot, airborne, and hold-state specifications. |
| `parallelFrameSpriteGenerator.js` requests six independent frames. | Consistent references help identity, but there is no temporal model tying trajectories together. | Keep as a speed baseline and key-pose authoring tool; measure pose diversity and order. |
| `extract_row_frames.py` defaults to individual silhouette-height equalization; jump/crouch can opt out. It contains LANCZOS resizing. | Legitimate crouch, twist, or squash can become changing body scale; later resampling can soften a previously established pixel grid. | Establish character scale once; apply one shared transform per clip. Quantize to the final grid after geometric transforms; nearest-neighbor for subsequent integer display scaling. |
| Frame anchors are inferred from the lowest silhouette/foot band. | Alternating feet, props, or detached effects can move the estimated pivot. | Retain root/contact metadata from the driver; report uncertain inferred anchors for review. Do not declare every changing foot centroid a defect. |
| Runtime schema already supports `frameCounts` and `Move.visualTimeline` entries `{frame,duration}`; CMS export forwards the latter. | We can preserve selected poses and holds without making combat timing inherit video FPS. | Export curated timing into those contracts; keep combat startup/active/recovery authoritative. |
| Current fast-image benchmark can mark successful generation `ok` based on output bytes. | API completion may be mistaken for a usable animation. | Separate transport success, extraction success, quality acceptance, and gameplay acceptance. |

Relevant source files: `cms/pipeline/adapters/minimaxH3SpriteSheetGeneratorAdapter.js`, `cms/pipeline/adapters/parallelFrameSpriteGenerator.js`, `scripts/extract_row_frames.py`, `scripts/benchmark_fast_image_generators.mjs`, `src/schema/types.ts`, and `cms/export/convertDraftToCharacterConfig.js`.

## Proposed asset pipeline

```text
Approved character reference + palette + proportions
                           │
Action template ────────────┤  timing, pose/contact/root tracks, camera
                           ▼
Image/key-pose edit → controlled video OR rig render
                           ▼
Raw frames + timestamps + tracked masks + preserved motion metadata
                           ▼
Semantic pose selection → shared alignment → palette/grid projection
                           ▼
Motion QA + alpha QA + native-size in-game review
                           ▼
RGBA atlas + frame timing + anchors + VFX sockets + editable source
```

### 1. Approve the character mold once

Store a neutral side-view stance and a small set of approved extremes: extended arm, kick, crouch, and relevant back/three-quarter view when an action turns. Record silhouette landmarks, body height, head/body proportions, costume geometry, weapon hand, outline weight, and palette. Do not repeatedly derive identity from the newest generated frame; every action points back to the approved reference version.

Test two source representations: the actual approved pixel sprite, and a higher-resolution **flat illustrated** version of the same design. The latter may provide more conditioning detail, but must retain the intended stylization. The research above supports testing this distinction; it does not justify defaulting to glossy 3D characters.

### 2. Author reusable motion templates

Each template carries action ID/version, facing, body family, loop/one-shot mode, intended timing, contact markers, root displacement policy, canvas envelope, and driver license/provenance. Begin with humanoids, then separate unusual anatomy into its own motion families.

For walk, author a complete left/right gait in place. The game owns world translation; calibrate visible stride against game speed. For jumping, distinguish launch, rise, apex, fall, and landing. The game owns the ballistic trajectory, so extract poses relative to the character root; do not bake upward video travel into the sprite and then apply the game jump again. For attacks, preserve anticipation, extension/contact, follow-through, and recovery. A reference filmed slowly for legibility can be retimed to the existing combat ticks after extraction.

Drive multiple characters with the same template before creating more templates. Retarget limb lengths to the character's proportions. Pose landmarks from a tiny pixel sprite can be unreliable; annotations or known rig joints are better ground truth than assuming a pose detector is correct.

### 3. Generate a single controlled action

Use one figure, fixed side camera, stable light, no stage/opponent/shadow, and sufficient canvas for the full silhouette. A kick needs forward room; a jump needs headroom. Specify the background using a color absent from the character palette. Camera-lock text is a constraint request, not a guarantee; reject zoom/cut/turn violations.

Short actions may need padding to satisfy a provider's minimum clip duration. Keep the action interval separate from the padded source duration. A four-second source clip can yield a half-second attack; the final animation must not inherit all four seconds.

### 4. Segment and normalize across time

Decode losslessly to working frames. Start with chroma removal for simple opaque characters, but detect the actual background color and connected exterior regions rather than deleting every vaguely magenta pixel. Review against black, white, and checkerboard backgrounds.

For difficult boundaries use temporally propagated masks with correction prompts, not unrelated background removal on every frame. SAM2 supports interactive video masks and propagation; that is useful tooling, not a guarantee of perfect tiny weapons/hair. Preserve holes and thin details deliberately. [Official SAM2 implementation](https://github.com/facebookresearch/sam2)

Apply one scale and camera transform across an action, retaining a root track. Stabilize unwanted camera drift, not intentional body movement. Use union bounds for cropping so reaching arms do not change frame scale. Keep source timestamps and transformed root/weapon sockets in a sidecar.

Set one palette and one pixel lattice for the entire action/character. Avoid per-frame palette fitting and unstable dithering. Downsampling and palette projection make pixels crisp; they do not repair anatomy, identity swaps, or attractive but unreadable poses. Corrections to those failures happen before final packing.

### 5. Select poses and timing intentionally

Choose extrema and semantic events before deciding frame count. Initial working ranges: 6–10 drawings for idle, 8–12 for a walk, and 6–12 for a short attack, adjusted by what reads well at native size. These are proposed production budgets, not model capabilities or universal animation rules.

Loops need phase and velocity continuity as well as similar endpoint images. A walk's half-period can look similar while the feet are swapped. Evaluate at least two repeats and avoid duplicating the same endpoint drawing as an extra hold. Do not use ping-pong playback to disguise a gait mismatch.

For a punch, an explicit impact drawing and a short hold may read better than all source frames played uniformly. Map selected frames to existing `visualTimeline` durations. Keep startup, active, recovery, cancel windows, and collision events in the combat system. Avoid optical-flow interpolation by default: new blended frames can blur outlines or invent intermediate anatomy without improving responsiveness.

### 6. Keep VFX separate

Generate the fighter performance without the giant fireball covering the hands. Give projectiles, trails, smoke, impact flashes, and summons their own layers/assets and event timing. Attach them to recorded sockets or intentional offsets. This keeps effects from contaminating body segmentation, anchors, palette scoring, and hurtboxes.

For opaque pixel effects, procedural arcs and hand-authored key shapes are strong baselines. For soft/translucent effects, ordinary chroma key loses useful alpha information. [Wan-Alpha](https://github.com/WeChatCV/Wan-Alpha) publishes text-to-RGBA video code/weights and demonstrates translucent effects; its image-to-video release remains on its TODO list. Treat it as an isolated VFX experiment, not the character-identity solution.

Ship the atlas and timing metadata together with raw MP4, selected RGBA frames, masks, reference hashes, and an editable animation source. Aseprite supports [frame durations and layers](https://www.aseprite.org/docs/sprite/) and [batch export](https://www.aseprite.org/docs/cli/), allowing a correction to survive regeneration of the packed atlas.

## Fine-tuning: what it can and cannot buy

Distinguish three jobs: a style adapter learns the project's rendering conventions; an identity adapter reinforces a recurring character; a motion/control model learns how conditioning maps to trajectories. A character LoRA does not make a punch land on combat tick 8, and a pixel-art style LoRA does not establish the root anchor.

Start with reference conditioning and motion control. Consider a shared style adapter only after the benchmark reveals repeated, measurable style failures and we have an approved training corpus. Prefer an adapter shared across the art direction to one training job for every fighter. An identity adapter becomes sensible for a frequently reused hero when reference conditioning demonstrably fails.

There is now concrete H3 training work: DiffSynth-Studio's September 8 announcement describes a DeCFG training adapter and toy identity/lineart LoRAs. Its actual [FL2VA training script](https://github.com/modelscope/DiffSynth-Studio/blob/main/examples/minimax_h3/model_training/lora/MiniMax-H3-FL2VA.sh) includes optional adapter fusion during training and states it should not be loaded at inference. This verifies a self-managed training route; it does **not** establish a hosted MiniMax fine-tuning API. [Upstream announcement](https://github.com/modelscope/DiffSynth-Studio)

H3 self-hosting has a material project-specific limitation: the published [H3 weight license](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE), dated August 2, 2026, lists the US among excluded territories and directs excluded-territory deployers to seek a separate license. It also restricts using H3 outputs to improve other model families. Therefore do not make US-based H3 self-hosting, fine-tuning, or cross-model synthetic training the default plan. Check the applicable hosted-service agreement separately; the weight license alone does not establish what our existing API account permits. The [official model card](https://huggingface.co/MiniMaxAI/MiniMax-H3) also distinguishes downloadable base checkpoints from hosted Context-IR and 2K components, so local performance/quality cannot simply be assumed equivalent to the full API.

For any training experiment, curate owned/licensed approved sequences with masks, palette, pose/root/contact metadata and action labels. Split evaluation by **character and motion template**, not adjacent frames from the same clip. Keep distorted rejected generations out of positive training data. Compare held-out acceptance and correction minutes against the untrained base. No defensible minimum dataset size or guaranteed training budget emerged from these sources for our art; use a bounded pilot and a learning curve.

## Scalability and cost

Represent work as durable stages: reference approved → motion prepared → provider submitted → source stored → extraction → QA → review → published. Persist provider task IDs immediately. Resume polling after worker restarts instead of paying for a duplicate request. Retry transient transport failures with backoff; treat a quality rejection as a new, tracked attempt with a changed input or seed and a cap. Reuse a source video when changing palette, crop, timing, or atlas layout.

Key the cache by reference version, action version, provider/model revision, conditioning hashes, seed where available, and settings. Cache postprocessing independently by source hash and extractor version. Separate GPU synthesis capacity from CPU extraction workers. Track queue time, generation time, processing time, review time, and result expiry/download status. Publish only approved versions; a successful API response should never overwrite the game's accepted asset automatically.

Primary business metric:

```text
cost per accepted character-action =
  (all billed attempts + postprocessing/hosting + allocated review/repair labor)
  / accepted character-action pairs
```

Count paid rejects, candidates not chosen, retries, and zero-acceptance batches. Also report acceptance per submitted candidate, first-pass acceptance, p50/p95 time to acceptance, and artist minutes per accepted action. API completion latency is not workflow speed.

As a concrete planning figure, fal currently lists Kling Motion Control V3 Standard at $0.126/output-second and Pro at $0.168/second: a five-second candidate is $0.63 or $0.84. These are published rates, not verified charges for this account. If Standard accepts one in four candidates, generation alone is about $2.52 per accepted action before review. [fal pricing page](https://fal.ai/kling-motion-control)

Self-hosting should win on measured accepted actions per GPU-hour after startup, utilization, storage, maintenance, and review costs. It is not automatically cheaper because weights are downloadable.

## Small benchmark and acceptance gate

**Screening pass:** three characters (existing Janitor, a different-proportion fighter, and a prop/large-silhouette fighter) × three actions (walk, jump, straight punch) × two candidates × the two hosted video lanes = 36 generated candidates. Use the same approved references and driver per action. At five seconds each, the 18 Kling Standard candidates imply about $11.34 at the cited rate; H3 cost must be checked against the applicable current account quote before execution. This is a proposed experiment, not spending performed here. Include existing image outputs and three rig actions as controls.

Inspect all candidates, including failures; do not only publish the winning seed. Advance the best approach to a second set with kick, fast recovery, a turning action, and a special whose VFX is separate. Use new characters in that second set. Two candidates per case are a screen, not a statistically reliable provider ranking.

An action is accepted only if it passes these checks at native game size and intended playback speed:

| Gate | Required evidence |
| --- | --- |
| Correct motion | Full requested action and required phase order; a near-static sequence fails even if its identity score is perfect. |
| Character continuity | Stable proportions, outfit, hand/weapon identity, outline language; no unexplained additions, missing limbs, or opponent. |
| Camera and framing | No unintended zoom/turn/cut; no clipped hands, feet, hair, or props. |
| Contact/root | Root-relative movement matches the driver; planted-foot residual stays within an initially proposed 1 native pixel during annotated contacts. This threshold is calibrated on approved examples, not asserted as universal. |
| Timing | Selected impact pose aligns with the game's contact tick; launch/apex/landing and recovery are ordered and readable. |
| Loop | Several repeats without a phase or velocity hitch; a same-looking endpoint alone is insufficient. |
| Alpha/grid/palette | Clean edges on white/black/checkerboard; no chroma holes; one consistent grid/palette; no frame-specific blur or scale pumping. |
| Playability | Looks correct in-engine with hitbox debug and normal speed; reviewer records acceptance and correction minutes. |

Automatic measures should assist review: clipping, connected-component anomalies, out-of-palette pixels, transparent-border defects, pose coverage, motion magnitude, root-conditioned foot residual, and loop phase differences. Raw silhouette difference, optical flow, or foot-centroid change alone are not jitter: real attacks change the silhouette. Pose models are uncertain on tiny stylized bodies; retain confidence and permit manual labels. Do not reduce all dimensions to one cosmetic similarity score.

## What to implement first

1. **Source-video ingestion and semantic extraction**, independent of providers: retain all timestamped frames; add loop/one-shot modes, explicit source-frame selection, shared scale/root metadata, and timing export. Run it on retained MP4s before buying more generations.
2. **A small versioned action-template library** with contact/root timing and approved driver clips. Add H3 `reference_video` and a fal motion-control adapter only after their request/response contracts are covered; both feed the same extractor.
3. **A reviewable benchmark report** that shows animated outputs, native-size contact sheets, accepted/rejected reasons, and total cost per accepted action. Reuse existing CMS review/export infrastructure.
4. **Only then select deployment and training strategy.** If controlled video still needs extensive redraws, expand the rig/render lane for common actions and reserve generated video for unusual performances and effects. If style is the repeated remaining defect, test one shared style adapter against the frozen benchmark.

The first investment is better motion control and extraction. That improves every provider, makes existing videos more useful, and gives us evidence for deciding whether fine-tuning will save work.

## Implementation update — September 16, 2026

The broader first implementation is now documented in [Animation clips](ANIMATION_CLIPS.md): a resumable fal video CLI, motion-adaptive or authored frame selection, shared-scale layered compiler, optional shared palette, root/socket metadata, runtime timing fragments, and an interactive Animation Lab. Topology/scale changes are declared intent, not automatically rejected as jitter.

Two live five-second Janitor image-to-video candidates were generated after correcting a too-small reference image: an acrobatic vault and a melt/reform transformation. Both were compiled to fifteen authored poses and are included as unapproved candidates. The transformation retains detached droplets and growth but does not fully achieve the requested final monster form; some droplets meet the source boundary. Three separately labelled procedural fixtures exercise known root motion, topology changes, and layered aura/projectile composition. These fixtures validate pipeline behavior, not model quality.

The proposed 36-candidate provider comparison has **not** been run. There is no validated model winner, trained adapter, automated art approval, or automatic publication of arbitrary new actions into combat. Motion-control transport is implemented and mocked-tested; the live examples used image-to-video. The current deliverable is the common generation/extraction/review foundation on which those comparisons can now be performed.
