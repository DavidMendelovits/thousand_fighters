# CMS Admin Design System

## Color Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#101318` | Page background |
| `--panel` | `#181d24` | Panel/card background |
| `--panel-2` | `#202732` | Nested/elevated surface |
| `--line` | `#374253` | Borders, dividers |
| `--text` | `#f2f6fb` | Primary text |
| `--muted` | `#9eabba` | Secondary text, labels |
| `--accent` | `#54d6a2` | Primary action, success, health-ok |
| `--accent-2` | `#f0b35b` | Warning, secondary CTA |
| `--danger` | `#ff6b6b` | Error, destructive |
| `--focus` | `#79a8ff` | Focus rings, hover borders |

### Raw colors (not yet tokenized)

| Hex | Context |
|-----|---------|
| `#26303c` | Button default background |
| `#2d3848` | Button hover background |
| `#2d3746` | Row/card borders, inner dividers |
| `#20332e` | Active/selected row bg (accent tint) |
| `#111820` | Deep inset bg (inputs readonly, scrub, pills) |
| `#121922` | Stat cell background |
| `#0f141b` | Input background |
| `#0d1117` | Log panel / process output bg |
| `#151d27` | Phase cell background |
| `#162033` | Chat user message bg |
| `#344052` | Animation preview borders |
| `#17202a` | Checkerboard base (animation preview) |
| `#1f5f48` / `#2e9f75` | Green action button (create draft) |
| `#6b4a1f` / `#a8742e` | Amber action button (run chain) |
| `#3b2020` / `#4e2a2a` | Danger button bg/hover (diagnose) |
| `#c6d2df`, `#cbd7e4`, `#dce6f0` | Intermediate text tones |
| `#6b7a8d`, `#7a8a9d`, `#5a6a7d` | Hint/placeholder text |
| `#45c790` | Accent hover (submit buttons) |

## Typography

- **Family:** Inter, ui-sans-serif, system-ui, -apple-system, sans-serif
- **Monospace:** ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace
- **Scale (px):** 24, 22, 18, 17, 16, 15, 14, 13, 12, 11, 10

## Spacing

- **Shell padding:** 18px (12px mobile)
- **Panel padding:** 14px (body), 24px (step content)
- **Grid gaps:** 16px (layout), 14px (columns/boards), 12px (forms), 10px (inner), 8px (lists), 6px (tight), 4px (micro)
- **Button padding:** 8px 12px (default), 4px 10px (small), 9px 18px (CTA)

## Border Radius

| Value | Usage |
|-------|-------|
| `999px` | Badges (pill shape) |
| `10px` | Modal box |
| `8px` | Panels, cards, previews, banners |
| `6px` | Buttons, rows, inputs, frame tiles |
| `4px` | Pills, step indicators, small tags |
| `3px` | Tiny inline controls (sprite row actions) |
| `50%` | Step number circles |

## Component Patterns

- **Panel** (`.panel`) — bordered card with `--panel` bg, 8px radius, 14px padding. `.panel-heading` is flex row with title + action.
- **Move card** (`.move-card`) — full-width card with header/body split. Pulsing border animation while loading. Header has title + action buttons; body is 200px sidebar + data pane.
- **Health badge** (`.health-badge`) — pill-shaped status indicator. Variants: `.health-ok` (green), `.health-warning` (amber), `.health-error` (red), `.health-unknown` (gray).
- **Error modal** (`.error-modal`) — fixed overlay with centered box (max 640px). Header/body/footer structure. Scrollable body with monospace pre blocks.
- **Chat thread** (`.chat-thread`) — scrollable message list (max 500px/50vh). Messages are bordered cards; `.chat-user` has distinct blue-tinted bg. Tool calls in collapsible `<details>`.
- **Dev tools** (`.dev-tools-panel`) — collapsible `<details>` panel with custom triangle marker, hover highlight on summary.
- **Next-step banner** (`.next-step-banner`) — accent-bordered CTA with label/title/detail + action button. Variants: default (green), `.banner-warn` (amber), `.banner-done` (muted green).
- **Step rail** (`.step-rail`, create.css) — sticky vertical stepper with numbered circles. States: default, `.active`, `.completed` (checkmark). Becomes horizontal scroll on mobile.
- **Sprite row** (`.sprite-row`) — collapsible row with header (label + status badge + actions) and horizontally scrollable frame strip.
- **Buttons** — default ghost (border + `#26303c`), primary (accent bg, dark text), danger (`#3b2020`), small (`.move-gen-btn`), pill (`.move-activity-btn`).
