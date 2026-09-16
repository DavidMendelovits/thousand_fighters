# Durable source-video generation

This CLI generates source motion for the offline animation compiler. It is separate from `IMAGE_GENERATOR_PROVIDER` and the legacy six-frame image adapters. Requires Node with built-in fetch, `ffprobe` for local image validation, and `FAL_KEY` in the process environment (for example through Doppler). It does not change Doppler configuration.

## Image-driven actions and transformations

Prepare an image at least 300 pixels on each side before running. Local image dimensions are checked with `ffprobe` before submission. Existing small sprite frames need an intentionally padded/upscaled reference; the CLI does not silently change framing. HTTPS inputs are not downloaded for local dimension checks and remain subject to provider validation.

```sh
doppler run -- node scripts/generate_animation_video.mjs \
  --provider fal --mode image-to-video \
  --image artifacts/animation-video/references/janitor-512.png \
  --duration 5 \
  --prompt "Locked side camera. One fighter performs a complete acrobatic leap and lands. Preserve pixel-art identity, full silhouette and flat magenta background." \
  --output artifacts/animation-video/janitor-leap
```

Use `--end-image target.png` to condition a final transformation state. The image-to-video default is `fal-ai/kling-video/v3/standard/image-to-video`, with `start_image_url`, optional `end_image_url`, duration 3–15 seconds, and audio disabled. The prompt is passed verbatim so morphs, auras, projectiles, and non-humanoid motion are not constrained by a humanoid action prompt. Give effects separate source jobs when independent compositing is needed. [Verified API schema, September 16, 2026](https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video/api)

## Motion-controlled actions

```sh
doppler run -- node scripts/generate_animation_video.mjs \
  --provider fal --mode motion-control \
  --image character.png --motion driver.mp4 \
  --orientation video \
  --prompt "Follow the driving performance with this character. Fixed side camera and flat background." \
  --output artifacts/animation-video/controlled-action
```

The default is `fal-ai/kling-video/v3/standard/motion-control`, using `image_url`, `video_url`, `character_orientation`, and `keep_original_sound=false`. Duration follows the driver, so `--duration` is rejected. The provider recommends a clearly visible realistic performer in the driving video, with limits of 30 seconds for `video` orientation and 10 for `image`. Local duration/body visibility is not automatically verified by this transport CLI; prepare the driver before submission. [Motion-control schema](https://fal.ai/models/fal-ai/kling-video/v3/standard/motion-control/api)

Images accept PNG/JPEG/WebP paths or HTTPS URLs. Drivers accept MP4/MOV/WebM paths or HTTPS URLs. Local files are sent as data URIs and limited to 50 MiB to bound request size. Larger videos should use a publicly reachable HTTPS URL. Provider size/aspect/content validation still applies. No source images or API keys are embedded in `job.json`; local file hashes/paths and URL hashes/origins provide provenance without persisting signed URL query strings.

## Resume and outputs

```sh
doppler run -- node scripts/generate_animation_video.mjs \
  --resume artifacts/animation-video/janitor-leap
```

`job.json` records a submission reservation before POST, then the request ID before polling. Resume **never submits**. If POST was accepted but its response was lost, the job remains uncertain; inspect fal request history and recover the existing request ID/queue URLs rather than blindly running a new paid generation. There is no remote exactly-once guarantee across that failure window.

Polling has a 15-minute default budget; use `--timeout-ms` and `--poll-ms` for a resumed wait. A timeout does not cancel the provider's job. Status/result requests send credentials only to validated `https://queue.fal.run/fal-ai/kling-video/.../requests/<id>` paths; redirects are rejected. Media downloads send no authentication. An exclusive `.video-job.lock` prevents concurrent writers. After a hard process kill, verify the recorded PID is no longer running, then remove that job's lock before resuming.

Successful download produces `source.mp4` and a SHA-256 record. Completed resumes verify and reuse it without network access. The MP4 signature is checked, but full decoding and visual validation belong to the offline compiler/review stage. Result media URLs are fetched afresh on resumed downloads and not persisted. A local source hash mismatch fails rather than silently overwriting it.

`transportStatus=downloaded` means bytes arrived; `qualityStatus=unreviewed` deliberately does not claim usable animation. Record gameplay/visual acceptance downstream. No cost estimate is fabricated; reconcile actual billed requests, rejected attempts, processing, and review against accepted actions.

Queue `COMPLETED` only means the handler finished; the result endpoint may still report a validation failure. Such HTTP 422 responses set `transportStatus=provider-rejected` and retain sanitized error type/location/message. Authentication values, embedded media, provider input objects, and signed URLs are excluded. The initial Janitor trials exposed `image_too_small`, so the local 300x300 preflight was added; those rejected tasks were not successful generated videos.

Run offline mocked checks with:

```sh
node scripts/smoke_cms_fal_video_generator.mjs
```
