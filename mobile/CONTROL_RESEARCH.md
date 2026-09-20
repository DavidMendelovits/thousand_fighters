# Mobile fighting controls: research and implementation

Researched September 16, 2026. Enjoyment is subjective; publisher descriptions
establish mechanics, not user satisfaction. These are design references, not a
claim that our new controls are already as enjoyable as established games.

## Useful references

- **Skullgirls Mobile**: the official site describes mobile-specific tap/swipe
  moves and combos. Lesson: simplify execution instead of miniaturizing every
  arcade input. [Official site](https://skullgirlsmobile.com/)
- **Brawlhalla mobile**: Ubisoft confirms customizable touch schemes and
  compatible controller support. Lesson: retain movement agency and accommodate
  different hands. [Ubisoft announcement](https://news.ubisoft.com/en-us/article/1kyM6xMlvLXtYa0un5XpKN/brawlhalla-now-available-on-mobile)
- **Streets of Rage 4** (a beat-em-up, not a head-to-head fighter): TouchArcade's
  favorable review describes a left analog stick and right action buttons;
  Destructoid praises the port while identifying problems executing some inputs
  on touch. Lesson: a good underlying game does not make touch motion commands
  automatically good. Use these reviews as subjective evidence, not universal
  consensus. [TouchArcade](https://toucharcade.com/2022/05/24/streets-of-rage-4-mobile-review-mr-x-nightmare-dlc-price-worth-it-iphone-ipad-pro-performance-controller-support-graphics-online-multiplayer/),
  [Destructoid](https://www.destructoid.com/streets-of-rage-4-mobile-impressions-android/)

## Decision for this engine (our inference)

Adopt a movement pad plus explicit, semantic action buttons. A pure swipe-to-dash
and tap-to-auto-combo game would sacrifice the spacing, directional projectiles,
air movement and combo timing already in this engine. Six combat actions replace
the nine-cell abbreviated arcade panel; less-frequent Boost/Form stay separate.
Grab is one input instead of requiring two buttons under one thumb. Jump and
Dash do not require a precise stick flick. Direction + Special preserves each
kit's alternate moves without replacing it with automatic outcome scripting.

This is a prototype control scheme to test, not a proven optimum. Six actions
still require learning, and directional Special may be demanding. A subsequent
A/B test should compare this layout with four core buttons plus a special wheel.
Do not add a wheel until measurements show the extra gesture is worth its cost.

## Technical choice

Reuse Phaser in an Expo WebView, keeping input and simulation on one side of the
bridge. Native handles selection, safe areas and lifecycle; it sends only suspend
and receives readiness/selection messages. This avoids per-touch bridge traffic,
but does not prove native-equivalent latency. Measure on real hardware.
[Expo SDK 57 WebView documentation](https://docs.expo.dev/versions/v57.0.0/sdk/webview/)

The standalone static fight build contains no authoring routes. Initial network
asset loading remains a release concern; native matches preload only the two
selected fighters and their forms. Offline packs and a renderer migration are
not silently claimed as delivered.

## Next playtest

Recruit novice and experienced players on a small iPhone and midrange Android.
Ask them, without coaching, to move/guard, grab, jump-dash, perform an alternate
special and win a round. Compare layouts over ten matches, not one scripted demo.
Measure accidental jumps, wrong specials, missed grabs, action latency (p50/p95),
frame-time spikes, thumb occlusion/fatigue, and voluntary rematches. Keep mobile
success metrics separate from generation API benchmarks.
