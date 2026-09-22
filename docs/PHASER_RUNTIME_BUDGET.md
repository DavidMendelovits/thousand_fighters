# Phaser runtime verification

Both Vite builds use `src/runtime/phaser-core.js`, with Container, Rectangle,
Line, their factories, and Math.Clamp restored explicitly. Canvas, WebGL and
WebAudio remain enabled. Matter and Arcade are excluded. `vite.phaser.ts`
replaces Phaser's webpack-style `typeof FEATURE` guards in production and in
Vite's dependency optimizer; simply defining a feature as false is insufficient
because `typeof false` is a truthy string.

Every production build checks its module graph for the core source entry and
for forbidden physics modules, then checks the sum of gzip sizes of all chunks
containing Phaser. It fails above 250,000 bytes and emits
`runtime-bundle-report.json` alongside the build. The fight build's single
chunk includes the game as well as Phaser, so its budget is stricter than an
engine-only limit. No source assets need to be regenerated for these checks.

```sh
npx vite build
npx vite build --config vite.fight.config.ts
node --test tests/runtime-bundle.test.js
ADMIN_BASE_URL=http://127.0.0.1:8787 RUNTIME_BASE_URL=http://127.0.0.1:5186 npx playwright test tests/runtime-core.spec.js
```

Serve the production build with `npx vite preview --host 127.0.0.1 --port 5186`.
The CMS on 8787 must be available for Testbed/Gym. Runtime smoke forces each
renderer separately and verifies actual scene startup, factories, Clamp,
WebAudio buffer playback, touch Jump, and the pause menu across Fight, Testbed,
and Gym. Desktop and mobile-emulated Chromium both passed on 2026-09-22; this
does not verify a physical phone or its audio output.

## Measurements on 2026-09-22

Vite's compressed-size display decreased from 320.01 KB to 180.79 KB for the
shared engine-containing chunk (43.5%). The fight-only application's entire
JavaScript chunk measured 212.82 KB. The build gate's Node gzip implementation
reported 179,757 bytes and 211,517 bytes respectively; Vite's size display uses
slightly different compression settings. Both are below the approved limit.

The final [version-2 paired desktop benchmark](../artifacts/runtime-performance/2026-09-22-desktop-paired-v2.json)
contains seven alternating cold browser contexts for the original full Phaser
build and the core build, using the same published Palimpsest assets. Other
project browser suites were stopped for this measurement window:

| Metric | Full Phaser | Core |
|---|---:|---:|
| Median navigation-to-fighter-ready | 1,337.2 ms | 1,284.1 ms |
| Median first movement response | 14.9 ms | 13.9 ms |
| Worst run's p95 frame interval | 9.1 ms | 9.1 ms |

**The desktop benchmark passed with the original thresholds unchanged:**
startup improved 3.97%, first-input response improved 6.71%, and worst-run p95
frame interval was below 20 ms. All fourteen samples accepted the key
synchronously and moved on exactly one simulation tick with no page errors.
Observed median display cadence was 8.3 ms throughout. Per-sample host CPU busy
fraction ranged from approximately 54% to 62%, so this was a quiet project-test
window rather than a completely idle computer. OS load and CPU data are retained
in the report. A representative physical phone remains unverified; desktop and
browser emulation do not clear that part of the release gate.

The original [version-1 raw report](../artifacts/runtime-performance/2026-09-22-desktop-paired.json)
is preserved for lineage. It reported 7.8 ms versus 16.4 ms first input and failed
the strict gate, prompting the timing investigation below. Its RAF observer was
phase-dependent, so it is not comparable to the corrected version-2 metric.

Follow-up diagnosis found identical core/full runtime timing configuration
(RAF, target 60, no FPS limit, smoothing enabled with history 10). A semantic
probe confirmed that 30 of 30 inputs in each build update Phaser's key state
synchronously, then move Palimpsest exactly 3px on the first simulation tick.
Required input/time/tween/camera/loader plugins match; only the unused optional
LightsPlugin is absent from core. Run `node scripts/diagnose_runtime_input.mjs`
against the two production preview origins to repeat this check.

The original wall-clock probe observed movement using its own RAF callback;
that callback can run before Phaser and observe movement a browser frame late.
Measurement version 2 instead starts after a completed simulation tick and
observes Phaser's `postrender` event. It records simulation ticks, render frames,
and the pre-input fixed-step accumulator to expose phase bias. Capture both
baseline and candidate with the same measurement version. The original raw
report is retained alongside the final version-2 comparison above.

```sh
# Capture a standalone baseline or candidate; errors and over-budget results exit 1.
RUNTIME_BASE_URL=http://127.0.0.1:5186 RUNTIME_REPORT=/tmp/runtime.json node scripts/benchmark_runtime.mjs
# Prefer alternating production builds on the same machine to reduce ordering bias.
RUNTIME_BASE_URL=http://127.0.0.1:5186 RUNTIME_BASELINE_URL=http://127.0.0.1:5187 RUNTIME_SAMPLES=7 RUNTIME_REPORT=/tmp/runtime-paired.json node scripts/benchmark_runtime.mjs
# A saved baseline can also be compared with RUNTIME_BASELINE=/tmp/baseline.json.
```

The benchmark triggers actual movement input, waits for the fighter to move,
then runs the normal render/simulation loop for 180 animation frames while
starting moves periodically. It records all samples and page errors. Its frame
gate uses the worst sample's p95 for the default sample count, rather than
hiding a slow run in the median. The report always marks physical-phone proof
false. Run on an otherwise idle machine; headless Chromium cannot establish the
physical-device release gate.
