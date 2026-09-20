# Thousand Fighters · Pocket Arena

Fight-only Expo SDK 57 app for iOS and Android. Native fighter picker, published
Oddities roster, CPU matches, landscape safe areas, leave confirmation, retry UI,
background pause, and keep-awake. Combat and multi-touch run together in the
existing Phaser engine inside `react-native-webview`; this is **not** a second
implementation of combat or a native rendering-engine port.

## Run locally

From the repository root, in two terminals:

```sh
npm run mobile:game
npm --prefix mobile install
npm run mobile:start
```

Use a matching SDK 57 Expo Go or a development build. The app derives the game
server from the Metro host at port 5174 in development. On a physical phone,
both processes must be reachable on your LAN; do not use `localhost` for the Mac.
For an explicit host, start Expo with:

```sh
EXPO_PUBLIC_GAME_URL=http://YOUR_MAC_LAN_IP:5174 npm run mobile:start
```

The only app environment setting is **EXPO_PUBLIC_GAME_URL** (a public origin,
not an API key). No image/video generation credentials belong in the app.
Expo's `EXPO_PUBLIC_` values are compiled into the client and are not secrets.

## Production

1. Run `npm run build:fight` from the root.
2. Deploy `dist-fight/` at a dedicated HTTPS origin root. It contains the fight
   entry and published runtime assets, not the CMS/workbench pages or generation
   sources. Provide normal static caching/CDN headers.
3. Set `EXPO_PUBLIC_GAME_URL` to that origin when bundling the Expo app.
4. Configure organization-owned signing/EAS project and test development builds
   on actual iOS and Android hardware before store submission.

Production rejects absent, credential-bearing, non-HTTPS, or localhost URLs.
Top-level WebView navigation stays on the configured origin's canonical `/fight` route. Legacy `/fight.html` links remain compatible.
Matches run locally after assets load, but this first version needs network
access to start: assets are hosted, **not packaged for offline play**. A pinned,
versioned offline asset pack is a subsequent release task. Do not point production
at the development Vite server (its routes are intentionally broader).

## Controls

| Input | Action |
| --- | --- |
| Left thumb pad | Move; away from opponent guards; down crouches |
| Punch / Kick | Normal attacks and hit-confirm combo links |
| Special | Signature; combine pad directions for kit-specific variants |
| Grab | Simultaneous LP+LK emitted as one atomic input |
| Jump | Dedicated jump; may combine with pad direction |
| Dash | Ground dash or airborne dodge; Down + airborne Dash gives wavedash approach |
| Boost / Form | Spend meter on the fighter's authored modifier/transformation |

Control settings pause the match and preserve its previous pause state. Mirror,
button size, and contrast persist per WebView origin. Every button target is at
least 44 CSS pixels. Landscape uses side rails; portrait browser fallback uses
a lower deck. One finger owns the pad; additional action fingers are independent.
Lost capture, cancellation, focus loss and suspension clear held input. Desktop
keyboard bindings remain intact.

## Verification

```sh
npx tsx --test tests/mobile-input.test.ts tests/runtime-smoothness.test.ts
npx playwright test tests/mobile-controls.spec.js tests/advanced-combat.spec.js --project=chromium
npx tsc --noEmit
npm --prefix mobile run typecheck
```

Browser tests require game servers on 5174 and 5173. Multi-touch tests use Chrome's
touch input protocol, not forced combat outcomes. Training stepping makes
assertions deterministic; native demonstration uses the ordinary live match.

## Remaining release gates

- Physical-device frame pacing, touch latency, thermal behavior and thumb fatigue.
- Android native runtime verification and platform back/background interruptions.
- Longer match playtests, controller support, accessibility alternatives to the pad.
- Offline/versioned asset delivery, production deployment, signed store builds.
- `npm audit` currently reports moderate Expo toolchain dependency advisories
  through xcode/uuid (no high/critical findings at installation). Do not accept its
  suggested downgrade to Expo 46; review an upstream compatible fix before release.

See [control research](./CONTROL_RESEARCH.md) for the design rationale.
