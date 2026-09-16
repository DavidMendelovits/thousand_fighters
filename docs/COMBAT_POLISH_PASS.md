# Combat polish pass — 2026-09-16

## Shipped locally

- Latch published through the workbench: 72 frames across 12 rows, five moves, including **Lock Clinch**. Seven new/replacement rows in this pass came from saved fal videos; walk-forward used image poses. Other existing attack rows are also video-derived. This is a mixed pipeline, not a claim that every sprite is video-generated.
- Spare Key has a separate muzzle effect, a separate projectile and projectile impact, and a 6-tick (100 ms) interrupt. Body art no longer contains its old clipped explosion. Older kick art still has an in-frame baked trail; full VFX separation across all legacy assets remains unfinished.
- Move Data → Tune exposes phase durations, damage, hitstun, blockstun, stun override, hitstop, knockback, meter cost, cancel targets/conditions, grab hold/pull/release timers, and socketed effects. Saves are drafts; QA and Publish remain explicit. Frame advantage is an estimate, not a promise about projectile travel or cancels. Pose timing is retimed by phase boundaries.
- Source → **Resample saved video** accepts six increasing timestamps starting at zero. It reuses the original MP4, without a provider call. Latch's kick was resampled to intact moments rather than padding over a clipped effect. Known source clipping still blocks export/publication.
- New hurt/getup row registration and playback. Brief reactions play within their actual lock duration; get-up reaches its final pose. Walk/jump visual translation no longer doubles the engine's physics movement. The video reference frame at t=0 anchors scale; extension height is not mistaken for body scale.
- **Control meter** measures hitstop, hitstun, dedicated stun, blockstun, grabs, knockdown/get-up, total locked percentage and longest continuous lock. Buckets are exclusive, pause time is excluded. “Free” includes self-imposed attack recovery; this is not a full input-actionability profiler.
- Grab-release immunity now survives forced recovery and then expires over 24 usable simulation ticks. It previously expired while the victim was still knocked down. Rotated knockdown sprites remain above the stage floor.
- New Fighter → **Import a published fighter** imports one fighter without overwriting a draft or changing the published fighter. Brine's authored geometry, extensions, hidden forms and move definitions are preserved. Imported root-level atlases are included in fresh exports.

## Still blocked / not certified

Fal returned HTTP 403, “Exhausted balance / TOP_UP”. Brine's backward-walk video completed; hurt, guard, get-up, forward walk and grab did not. No retries or top-ups were made. Those requests have saved job records. After funding the account, an explicit Generate/Regen can replace a definitive rejected submission; ambiguous submissions with an existing request ID are resumed instead of duplicated.

Brine remains an imported CMS draft with its existing published runtime unchanged. Its whole new animation set is **not complete**. Latch has no dedicated crouch, dash or throw row yet (engine fallbacks remain). Latch's QA has zero errors but still reports anchor/normalization warnings. Automated bounds checks do not certify semantic pose quality, perfect loops or absence of model drift. The new animations remain six sampled key poses, not all frames from a 60 fps source.

## Evidence

- `artifacts/combat-polish/latch-brine-demo.mp4`: 14.1-second recording of the real engine driven by keyboard events via agent-browser, not generated fight footage. Startup loading was trimmed; no gameplay was synthesized. Approximately 0–2s approach, 2–3s clinch/release, 3–4s jump, 4–5s projectile, 5–11s CPU exchange, 11–14s live control meter. Original takes are retained under `.cache/combat-polish-takes/`.
- Encoded MP4 inspected using a contact sheet covering the clip, plus playback at 0, 3, 7 and 11 seconds with advancing decoded frames. `demo-qa.jpg` and `demo-playback.png` record that check. The walkthrough skill caught a first take with missed keyboard inputs; it was not delivered as the final demonstration.
- `latch-authoring.json` / `brine-authoring.json`: snapshots of the actual CMS drafts; these preserve work otherwise held in ignored `cms-data`.
- `latch-qa.json`: published pack's QA, zero errors; warnings are retained rather than suppressed.
- Regression coverage includes short interrupts, forms, combos, projectile impacts, editor save/rejection, effect cleanup, grab recovery protection, import safety, resampling input validation, source bounds and video locomotion anchors.
- Verification: production build passed (existing Phaser bundle-size warning), 32 desktop/mobile browser checks, 41 TypeScript/Node unit checks, 5 Python extraction checks, 62 export smoke assertions, and row-registry/playback, QA, video-provider and workbench smoke suites passed. Real UI import, resampling, move save, QA and Latch publication were exercised with agent-browser.

The live sample is illustrative, not a controlled balance benchmark. Brine's launcher/grab recovery is still relatively oppressive; next tuning should compare equal scripted match scenarios and add defensive counterplay, not shorten every move indiscriminately.
