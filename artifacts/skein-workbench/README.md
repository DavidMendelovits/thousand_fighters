# Skein: recorded workbench attempt

September 19, 2026. **Incomplete creation attempt, not a finished-character or gameplay demonstration.**

Watch `skein-workbench-attempt.mp4` (7:53, 1440×1000 H.264). This is actual agent-browser capture of the local CMS. Four raw recordings are concatenated at normal speed, with processing waits retained. Gaps between takes omit development/debugging work; page reloads at take boundaries are visible. There is no narration, fabricated UI, or simulated gameplay.

| Time | Actual recorded workflow | Outcome |
|---|---|---|
| 0:00–1:31 | New Fighter form, paint direction, character brief, Create Fighter | Skein draft created with four authored moves |
| 1:31–3:07 | Generate and inspect first BFL reference | Generated, but rejected: labeled multi-pose sheet instead of one reference |
| 3:07–4:46 | Separate visual brief, save, regenerate and inspect | Save race exposed; subsequent image still had unwanted anatomy |
| 4:46–7:53 | Refine brief and submit stronger BFL model | Request timed out; no approved image |

## What exists

- Persisted Skein draft, reference attempts, lineage snapshots, and four generation-attempt ledger entries.
- Three Klein image requests completed in 5.629, 5.680 and 5.123 seconds. These are API attempt durations, not time to an accepted character.
- One FLUX.2 Pro request timed out after 121.092 seconds; its provider ID was not retained by the old adapter. No repeat of that uncertain paid request was submitted.
- No approved reference, video motion, completed animation pack, publication, or gameplay capture for Skein.

## Repairs prompted by the run

- Persist explicit pixel/paint/watercolor selection; reject unsupported values before model work.
- Separate appearance-only `artBrief` from gameplay instructions and expose it in the workbench.
- Await visual-brief saving before generation and block generation after a failed save.
- Material-aware locomotion prompts and painted sheet resolution, without forcing low-resolution pixelation onto paint.
- Correct the narrow-screen creation form layout.
- Keep unknown estimated cost as unknown rather than zero.
- Journal BFL accepted IDs before polling; retain IDs on failure and suppress automatic retries after accepted or uncertain submissions. This is not yet a complete resume UI or an exactly-once guarantee across manual resubmissions.

## Recording verification

Decoded contact sheet covers the whole encoded file. Browser playback at the creation and reference-edit intervals was inspected; the creation interval advanced from 40 to 82 seconds with decoded frames and showed the created draft. Final timeout interval was separately inspected through the end: the UI returns from Generating to Generate, but the activity error text is above the scrolled viewport. The failed benchmark independently records the timeout. Brief reset/loading screens and stationary processing waits are genuine and intentionally retained. No secrets appear in the inspected frames.

## Remaining acceptance gate

Recover the uncertain provider result if its task ID can be obtained, or explicitly choose a replacement reference attempt. Approve identity before spending on motion. Then create video-derived movement, add and animate the controlled summon through the workbench, review every required row, publish, and record real gameplay. This gate is still open.
