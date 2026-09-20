# Validation · September 16, 2026

- Root TypeScript and mobile TypeScript: pass.
- Expo SDK 57 dependency compatibility check: pass.
- Runtime/input/mobile URL unit suites: 30 passing tests.
- Existing advanced-combat browser suite: 8 passing tests.
- New mobile-control browser suite: 5 passing tests, including Chrome protocol
  multi-touch, atomic grab, jump, persistent settings, portrait/landscape bounds,
  suspend/resume and finger-sized restart controls.
- `npm run build:fight`: pass. Built client loaded in browser on port 5175;
  `/cms-admin` on that standalone preview returns 404.
- `expo export --platform ios --platform android`: both Hermes bundles exported.
  This verifies bundling, not native binary signing or Android device execution.
- iPhone 16 simulator / Expo Go 57: selected Brine and Madame Meridian, entered
  a CPU match, returned through Choose Fighters, started another fight, used
  the movement pad and action buttons, and opened Pause. Readable native/web
  accessibility controls verified in agent-device snapshots.
- The simulator's old Expo Go was updated to SDK 57 before validation.

Local evidence (ignored build/test artifacts):

- `artifacts/mobile/mobile-fighting-demo.mp4`: 19-second live iOS simulator
  recording; rotated/transcoded for viewing. Actual input-driven match, no
  synthesized frames or forced combat outcomes. Simulator Expo gear overlay
  is development chrome, not a shipped game control.
- `artifacts/mobile/production-fight.png`: standalone client screenshot.
- Playwright viewport screenshots in `test-results/`.

Limitations: no physical-device latency, sustained FPS/thermal, battery or
ergonomics measurements yet; no native Android runtime session; no signed
App Store/Play build; initial assets require network access. Automated correctness
checks are not a substitute for playtests establishing enjoyment.
