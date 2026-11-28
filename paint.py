#!/usr/bin/env python3
"""Paint a fighter's pose sheet with an image model.

Whole sheet, six poses per request (the first pass for a new fighter):
    python3 paint.py <rig_sheet.png> <out_sheet.png> "<character description>" --model gpt-image-2 [--work DIR]

Single poses, one request each (to repaint cells the first pass got wrong):
    python3 paint.py <rig_sheet.png> <out_sheet.png> "<character description>" --model gpt-image-2 \\
        --fighter fighters/faro.json --keys hit,jp.w,jk.w --tries 3 [--judge]

rig_sheet.png is the studio's "Download pose sheet" (256px cells, 8 columns, magenta background).

Whole sheet: each batch of 6 poses goes to the model with the character reference; every painted cell is keyed
and snapped back onto the rig's position and size, so anchors and hitboxes still line up.

Single poses: out_sheet must already exist; only the named cells change. Each request carries three images: the
character (out_sheet's idle cell, or --ref), the nearest pose that is already painted right (for style, not pose),
and a colour-coded stick figure drawn from the rig's joints (left arm red, right arm blue, left leg green,
right leg orange, so the model can't swap or mirror limbs). The prompt describes the pose in words from the rig.
Each try is checked (qa.py's structural checks, plus the yes/no pose judge with --judge) and the first one that
passes is kept; if none passes, the best try goes in and the cell is listed as failing.

The image model is always explicit: --model or OPENAI_IMAGE_MODEL (bare names go to OpenAI, or codex with no key). Every run is recorded next to the sheet in
<out_sheet>.paint.json (model, quality, mode, cells, time) and, in more detail, in the work dir's run.json.
Single poses ask the Images API for a transparent background (--background auto, the default); if the model
refuses it (gpt-image-2 does), the run carries on with a magenta background and keying, and logs that.
--dry-run builds every guide, reference and prompt and prints what it would send, without calling anything.

Resumable: finished requests are cached in the work dir (default <out_sheet>.work).
The model is pluggable: --model takes a name from image_models.json (gpt-image-2, nano-banana-2, flux-2-pro...),
provider:model id, or a bare OpenAI model name. providers.py has one adapter per provider and normalizes every
model's output (size, backdrop) before keying, so the snap-to-rig step and qa.py don't change per model.
bakeoff.py paints the same poses on several models and compares cost, time and QA.
"""
import argparse, datetime, json, os, statistics, subprocess, sys
import providers
from providers import BackgroundUnsupported, NoRetry
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

CELL, COLS, BIG = 256, 8, 512
POSE = 1024  # single-pose requests are square: one 256px cell scaled 4x
MAGENTA = (255, 0, 255)
BASE = ("Style: clean hand-drawn 2D fighting-game sprite, bold dark outline, flat cel shading, readable silhouette. "
        "No fire, glow, aura, halo, motion lines, shadows, text or borders. ")
STYLE = BASE + "Background is flat pure magenta #ff00ff everywhere: one solid colour, no gradient, no vignette, no glow, never dark."
# --background transparent: the API returns real alpha, so nothing has to be keyed out. The attached images stay on
# magenta (the edits endpoint can read an input's transparency as a region to edit), so the prompt says to ignore it.
CLEAR = BASE + ("Transparent background: nothing at all behind or around the character, no backdrop, colour, glow, halo or vignette. "
                "The magenta in the attached images is only their backdrop; do not paint it.")
# Guide colours: one per limb, none close to magenta or to each other. Back (farther) limbs are drawn first.
LIMB = {'armF': (230, 40, 40), 'armB': (40, 90, 240), 'legF': (30, 170, 60), 'legB': (255, 150, 20), 'body': (90, 90, 90)}

RUN = {}  # what this run sent, for run.json


def background(args):
    """'transparent' or 'magenta' for this run's single-pose requests. auto = transparent when the model can do it
    (or might: transparent null in image_models.json), magenta otherwise."""
    if args.background == 'magenta' or args.m.transparent is False:
        if args.background == 'transparent': sys.exit(f'{args.m.name} can\'t paint a transparent background (image_models.json); use --background auto or magenta')
        return 'magenta'
    return 'transparent'


def provider(args):
    """Which model paints, as recorded: '<provider>:<model id>', e.g. 'openai:gpt-image-2' or 'fal:fal-ai/nano-banana-2/edit'."""
    return args.m.label


def paint(prompt, images, out, size, args):
    """Provider seam: (prompt, input image paths, output path, size). The model is args.m (providers.resolve(--model));
    every adapter's output is normalized to `size` and a magenta or transparent backdrop before it comes back."""
    return args.m.paint(prompt, images, out, size, background=getattr(args, 'bg', 'magenta'), quality=args.quality)


def request(prompt, images, out, size, args, tag):
    """paint() with one retry, logged to RUN; --dry-run only logs."""
    entry = {'tag': tag, 'out': os.path.basename(out), 'size': size, 'background': getattr(args, 'bg', 'magenta'),
             'images': [os.path.basename(i) for i in images], 'prompt': prompt}
    RUN.setdefault('requests', []).append(entry)
    if args.dry_run: return False
    if args.m.missing_key(): sys.exit(f'{args.m.name} needs {args.m.missing_key()} to paint {tag} (cached requests need no key)')
    for attempt in (1, 2):
        try:
            entry.update(paint(prompt, images, out, size, args) or {}); entry['attempts'] = attempt; return True
        except (BackgroundUnsupported, NoRetry):
            raise
        except Exception as e:
            print('  retry:', e, flush=True)
            if attempt == 2: raise


def key(im):
    """Magenta -> transparent, with the magenta fringe pulled out of edge pixels. Alpha already in im is kept, so a
    transparent-background result passes through with only stray magenta removed."""
    a = np.array(im.convert('RGBA')).astype(int)
    m = np.minimum(a[..., 0], a[..., 2]) - a[..., 1]  # how magenta each pixel is
    edge = (m > 30) & (m <= 90)
    a[..., 0] = np.where(edge, a[..., 0] - m // 2, a[..., 0]); a[..., 2] = np.where(edge, a[..., 2] - m // 2, a[..., 2])
    a[m > 90] = 0
    return Image.fromarray(a.astype(np.uint8))


def despeck(im, keep=0.05):  # Faro's only detached piece over 0.5% was a 4.3% stray fragment
    """Drop detached blobs smaller than `keep` of the figure, so stray fragments don't move the box."""
    a = np.array(im); lab, n = ndimage.label(a[..., 3] > 0)
    if n < 2: return im
    sizes = ndimage.sum(np.ones(lab.shape), lab, range(1, n + 1))
    a[np.isin(lab, 1 + np.flatnonzero(sizes < keep * sizes.sum()))] = 0
    return Image.fromarray(a)


def cell_of(sheet, i):
    return sheet.crop(((i % COLS) * CELL, (i // COLS) * CELL, (i % COLS + 1) * CELL, (i // COLS + 1) * CELL))


def place(fig, want, s, size):
    """Scale a cropped figure by s and put it in a size x size tile on the rig's feet line and horizontal centre."""
    fig = fig.resize((max(1, round(fig.width * s)), max(1, round(fig.height * s))), Image.LANCZOS)
    tile = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    tile.paste(fig, (round((want[0] + want[2]) / 2 - fig.width / 2), want[3] - fig.height))
    return tile


def record(args, mode, cells, extra=None):
    """Append this run to <out_sheet>.paint.json (committed with the sheet) and write the work dir's run.json."""
    sent = [r for r in RUN.get('requests', []) if 'seconds' in r]  # requests that reached the model this run (not cached)
    m = args.m
    entry = {'when': datetime.datetime.now().astimezone().isoformat(timespec='seconds'), 'mode': mode, 'provider': provider(args),
             'model': m.name, 'quality': args.quality or m.extra.get('quality'),
             'base_url': os.environ.get('OPENAI_BASE_URL', 'https://api.openai.com/v1') if m.provider == 'openai' else None,
             'cells': cells, 'sent': len(sent), 'paint_seconds': round(sum(r['seconds'] for r in sent), 1),
             'cost_estimate': round(len(sent) * m.cost, 2) if m.cost is not None else None, **(extra or {})}
    side = os.path.splitext(args.out_sheet)[0] + '.paint.json'
    log = json.load(open(side)) if os.path.exists(side) else []
    log.append(entry); json.dump(log, open(side, 'w'), indent=1)
    json.dump({**entry, **RUN}, open(f'{args.work}/run.json', 'w'), indent=1)
    print('recorded in', side)


# ---- whole sheet, six poses per request ---------------------------------------------------------------------

def batch_mode(args):
    rig = Image.open(args.rig_sheet).convert('RGB')
    total = COLS * rig.height // CELL
    cells = 1 + max(i for i in range(total) if cell_of(rig, i).getcolors(1) is None)  # last cell that is not blank background
    size = '1536x1024'

    ref = f'{args.work}/ref.png'
    if not os.path.exists(ref):
        print('reference…', flush=True)
        request(f"A single full-body character design for a 2D fighting game, standing in a fighting stance, side view facing right, centered. Character: {args.desc} {STYLE}", [], ref, size, args, 'ref')

    sheet, figs = Image.new('RGBA', rig.size, (0, 0, 0, 0)), []
    for c in range(0, cells, 6):
        got = f'{args.work}/batch_{c:02d}.png'
        guide = Image.new('RGB', (BIG * 3, BIG * 2), MAGENTA)
        for k in range(6):
            if c + k < cells: guide.paste(cell_of(rig, c + k).resize((BIG, BIG), Image.LANCZOS), ((k % 3) * BIG, (k // 3) * BIG))
        if not os.path.exists(got):
            print(f'batch {c // 6 + 1}/{-(-cells // 6)}…', flush=True)
            gp = f'{args.work}/guide_{c:02d}.png'; guide.save(gp)
            request("Two images are attached. Image 1 is the character reference. Image 2 is a pose guide: a 3x2 grid of six mannequin poses on magenta. "
                    "Make a 1536x1024 image with the same 3x2 layout. In each cell draw the SAME character as image 1 — same face, hair, outfit, colours and proportions — "
                    "full body, side view facing right, in exactly that cell's mannequin pose: same limb angles, same size, same position in the cell, feet at the same height. "
                    "Keep every figure fully inside its own cell. Empty magenta cells stay empty. " + STYLE, [ref, gp], got, size, args, f'batch {c}')
        if not os.path.exists(got): continue  # dry run
        painted = Image.open(got).convert('RGB').resize((BIG * 3, BIG * 2), Image.LANCZOS)
        for k in range(6):
            i = c + k
            if i >= cells: break
            box = ((k % 3) * BIG, (k // 3) * BIG, (k % 3 + 1) * BIG, (k // 3 + 1) * BIG)
            fig, want = despeck(key(painted.crop(box))), key(guide.crop(box)).getbbox()
            have = fig.getbbox()
            if not have or not want: print(f'  cell {i}: empty, left blank', flush=True); continue
            fig = fig.crop(have)
            figs.append((i, fig, want, max(want[2] - want[0], want[3] - want[1]) / max(fig.width, fig.height)))
    if args.dry_run:
        print(json.dumps(RUN, indent=1)); return

    # One scale for the whole character: the median of each pose's own fit, so a pose with a stray
    # fragment or an oversized limb keeps the same body size instead of shrinking or swelling.
    # ponytail: median of bbox fits; measure a stable feature (head size) if poses still pulse.
    s = statistics.median(f[3] for f in figs)
    for i, fig, want, own in figs:
        if abs(own / s - 1) > 0.25: print(f'  cell {i}: own fit {own / s:.2f}x the median, check it', flush=True)
        sheet.paste(place(fig, want, s, BIG).resize((CELL, CELL), Image.LANCZOS), ((i % COLS) * CELL, (i // COLS) * CELL))
    sheet.save(args.out_sheet)
    print('wrote', args.out_sheet, f'(scale {s:.3f})')
    record(args, 'batch', list(range(cells)), {'scale': round(s, 4)})


# ---- single poses, one request each -------------------------------------------------------------------------

def pose_data(fighter):
    here = os.path.dirname(os.path.abspath(__file__))
    out = subprocess.run(['npx', '--prefix', here, 'tsx', os.path.join(here, 'posedata.ts'), fighter], capture_output=True, text=True, cwd=here)
    if out.returncode: sys.exit('posedata.ts failed: ' + out.stderr[-500:])
    return json.loads(out.stdout)


def guide_image(c, size=POSE):
    """The rig's pose as a stick figure on magenta, one colour per limb, at size x size (cell px scaled up)."""
    k = size / CELL
    im = Image.new('RGB', (size, size), MAGENTA); g = ImageDraw.Draw(im)
    J = {n: (x * k, y * k) for n, (x, y) in c['joints'].items()}
    def seg(a, b, col, w):
        g.line([J[a], J[b]], fill=(20, 20, 20), width=round((w + 4) * k)); g.line([J[a], J[b]], fill=col, width=round(w * k))
        for p in (J[a], J[b]): g.ellipse([p[0] - w * k / 2, p[1] - w * k / 2, p[0] + w * k / 2, p[1] + w * k / 2], fill=col)
    def limb(a, b, c2, col, w): seg(a, b, col, w); seg(b, c2, col, w)
    limb('sh', 'elB', 'fiB', LIMB['armB'], 8); limb('hip', 'knB', 'ftB', LIMB['legB'], 10)
    seg('hip', 'sh', LIMB['body'], 18)
    limb('hip', 'knF', 'ftF', LIMB['legF'], 10)
    r = c['headR'] * k; hx, hy = J['head']
    g.ellipse([hx - r, hy - r, hx + r, hy + r], fill=LIMB['body'], outline=(20, 20, 20), width=round(3 * k))
    g.polygon([(hx + r * 0.9, hy - r * 0.3), (hx + r * 1.5, hy), (hx + r * 0.9, hy + r * 0.3)], fill=(20, 20, 20))  # nose: which way it faces
    limb('sh', 'elF', 'fiF', LIMB['armF'], 8)
    for f, col in (('fiF', LIMB['armF']), ('fiB', LIMB['armB'])):
        x, y = J[f]; g.ellipse([x - 6 * k, y - 6 * k, x + 6 * k, y + 6 * k], fill=col, outline=(20, 20, 20), width=round(2 * k))
    return im


def on_magenta(cell_img, size=POSE):
    """A painted 256px cell, scaled up and flattened onto magenta, to send as a reference image."""
    bg = Image.new('RGBA', (size, size), MAGENTA + (255,))
    bg.alpha_composite(cell_img.convert('RGBA').resize((size, size), Image.LANCZOS))
    return bg.convert('RGB')


def pose_distance(a, b):
    """Joint-angle distance between two rig poses (degrees, wrapped), hip shift ignored."""
    return sum(abs(((x - y + 180) % 360) - 180) for x, y in zip(a[:10], b[:10]))


def nearest_painted(c, data, sheet, skip):
    """The closest pose that is already painted and not being redone, preferring the same airborne state."""
    best = None
    for o in data['cells']:
        if o['key'] in skip or o['index'] == c['index'] or not cell_of(sheet, o['index']).getbbox(): continue
        d = pose_distance(c['pose'], o['pose']) + (0 if o['air'] == c['air'] else 120)
        if best is None or d < best[0]: best = (d, o)
    return best[1]


def pose_prompt(c, desc, near, bg='magenta'):
    moves = '; '.join(c['usedBy']) or c['key']
    g = 3 if near else 2
    return (f"{g} images are attached. Image 1 is the character reference. "
            + (f"Image 2 is the same character already drawn in another pose ({near['key']}); use it for style, colours and proportions only, not for the pose. " if near else '')
            + f"Image {g} is the pose guide: a stick figure on magenta, side view facing right (the black nose points the way the character faces). "
            "Red is the character's left arm, the one nearer the viewer; blue is the right arm, farther from the viewer; "
            "green is the left leg, nearer; orange is the right leg, farther; grey is the torso and head. "
            f"Draw one 1024x1024 image: the SAME character as image 1 (character: {desc}), full body, side view facing right, in exactly the pose of image {g}. "
            f"This frame is the {moves}. The pose: {c['sentence']} "
            "Match each limb's angle and where each hand and foot ends up, and match the figure's size and position in the frame, feet at the guide's height. "
            "Do not mirror the pose or swap left and right limbs. Draw the pose exactly as shown even if it looks unusual; "
            "do not fall back to a standing guard stance. Keep the whole figure inside the frame. " + (CLEAR if bg == 'transparent' else STYLE))


def pose_mode(args):
    import qa  # structural checks and the judge live in qa.py
    data = pose_data(args.fighter)
    by_key = {c['key']: c for c in data['cells']}
    keys = [k.strip() for k in args.keys.split(',') if k.strip()]
    bad = [k for k in keys if k not in by_key]
    if bad: sys.exit(f'not in this fighter\'s sheet: {", ".join(bad)}')
    if not os.path.exists(args.out_sheet): sys.exit(f'{args.out_sheet} must exist: single-pose mode repaints cells of a painted sheet')
    rig, sheet = Image.open(args.rig_sheet).convert('RGB'), Image.open(args.out_sheet).convert('RGBA')
    pv = provider(args); size = f'{POSE}x{POSE}'; args.bg = background(args)

    ref = args.ref
    if not ref:  # the sheet's own idle cell is the character, exactly as it already looks in game
        ref = f'{args.work}/ref_idle0.png'; on_magenta(cell_of(sheet, by_key['idle0']['index'])).save(ref)

    # Scale: keep each new figure the same size, relative to its rig pose, as the cells that are already right.
    ratios = []
    for o in data['cells']:
        if o['key'] in keys: continue
        have, want = cell_of(sheet, o['index']).getbbox(), key(cell_of(rig, o['index'])).getbbox()
        if have and want: ratios.append(max(have[2] - have[0], have[3] - have[1]) / max(want[2] - want[0], want[3] - want[1]))
    fit = statistics.median(ratios) if ratios else 1.0
    print(f'{pv}, {args.bg} background, {len(keys)} cells, up to {args.tries} tries each, judge {"on: " + args.judge_model if args.judge else "off"}', flush=True)

    results, ctx = {}, qa.sheet_context(rig, sheet, data['cells'], skip=keys)
    for k in keys:
        c = by_key[k]; i = c['index']
        gp = f'{args.work}/guide_{k}.png'; guide_image(c).save(gp)
        near = None if args.no_near or args.m.max_refs < 3 else nearest_painted(c, data, sheet, set(keys))  # a 2-image model gets no style ref
        np_ = f'{args.work}/near_{k}.png'
        if near: on_magenta(cell_of(sheet, near['index'])).save(np_)
        images = [ref, np_, gp] if near else [ref, gp]
        want = key(cell_of(rig, i).resize((POSE, POSE), Image.LANCZOS)).getbbox()
        tries = []
        for t in range(1, args.tries + 1):
            got = f'{args.work}/pose_{k}_{t}.png'
            if not os.path.exists(got):
                print(f'{k}: try {t}…', flush=True)
                try:
                    request(pose_prompt(c, args.desc, near, args.bg), images, got, size, args, f'{k} try {t}')
                except BackgroundUnsupported as e:
                    if args.background == 'transparent': sys.exit(f'{args.m.name} refused a transparent background: {e}')
                    print(f'  {args.m.name} refused a transparent background, using magenta from here: {e}', flush=True)
                    args.bg = 'magenta'; RUN['background_fallback'] = str(e)
                    request(pose_prompt(c, args.desc, near, args.bg), images, got, size, args, f'{k} try {t}')
            if not os.path.exists(got): break  # dry run
            fig = despeck(key(Image.open(got).convert('RGBA').resize((POSE, POSE), Image.LANCZOS)))
            have = fig.getbbox()
            if not have or not want: tries.append({'try': t, 'ok': False, 'problems': ['empty']}); continue
            fig = fig.crop(have)
            s = fit * max(want[2] - want[0], want[3] - want[1]) / max(fig.width, fig.height)
            painted = place(fig, want, s, POSE).resize((CELL, CELL), Image.LANCZOS)
            painted.save(f'{args.work}/cell_{k}_{t}.png')
            problems = qa.structural(painted, cell_of(rig, i), ctx)
            verdict = qa.judge(painted, c['checks'], args.judge_model) if args.judge else None
            wrong = [a['id'] for a in (verdict or []) if not a['match']]
            tries.append({'try': t, 'ok': not problems and not wrong, 'problems': problems, 'judge': verdict, 'wrong': wrong})
            print(f'  try {t}: {"pass" if tries[-1]["ok"] else "fail"}' + (f' ({", ".join(problems + wrong)})' if problems or wrong else ''), flush=True)
            if tries[-1]['ok']: break
        if not tries: results[k] = {'near': near and near['key'], 'tries': []}; continue
        best = max(tries, key=lambda r: (r['ok'], -len(r.get('wrong', [])) - len(r['problems'])))
        if os.path.exists(f'{args.work}/cell_{k}_{best["try"]}.png'):
            x, y = (i % COLS) * CELL, (i // COLS) * CELL
            sheet.paste(Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0)), (x, y))
            sheet.alpha_composite(Image.open(f'{args.work}/cell_{k}_{best["try"]}.png'), (x, y))
        results[k] = {'near': near and near['key'], 'kept': best['try'], 'ok': best['ok'], 'tries': tries}

    if args.dry_run:
        print(json.dumps(RUN, indent=1)); print(f'dry run: {len(RUN.get("requests", []))} requests would be sent at most {len(keys) * args.tries}'); return
    sheet.save(args.out_sheet)
    failing = [k for k, r in results.items() if not r.get('ok')]
    print('wrote', args.out_sheet, '| failing:', ', '.join(failing) if failing else 'none')
    record(args, 'pose', keys, {'background': args.bg, 'tries': args.tries, 'judge': args.judge_model if args.judge else None, 'failing': failing,
                                 'requests': sum(len(r['tries']) for r in results.values())})
    RUN['results'] = results
    json.dump({**json.load(open(f'{args.work}/run.json')), 'results': results}, open(f'{args.work}/run.json', 'w'), indent=1)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('rig_sheet'); ap.add_argument('out_sheet'); ap.add_argument('desc')
    ap.add_argument('workdir', nargs='?', help='same as --work (kept for old commands)')
    ap.add_argument('--work', help='cache dir (default <out_sheet>.work)')
    ap.add_argument('--model', default=os.environ.get('OPENAI_IMAGE_MODEL'),
                    help='image model: a name in image_models.json, provider:model id, or a bare OpenAI model (default: OPENAI_IMAGE_MODEL)')
    ap.add_argument('--models-file', help='model table (default image_models.json next to paint.py)')
    ap.add_argument('--quality', help='image quality to request (low, medium, high); omitted = the API default')
    ap.add_argument('--fighter', help='fighter JSON; with --keys, repaints single poses')
    ap.add_argument('--keys', help='comma-separated sheet keys to repaint, e.g. hit,jp.w,tend.s')
    ap.add_argument('--tries', type=int, default=3, help='requests per pose at most (default 3)')
    ap.add_argument('--no-near', action='store_true', help='send no nearest-pose reference, only the character and the guide')
    ap.add_argument('--ref', help='character reference image (default: the sheet\'s idle0 cell)')
    ap.add_argument('--judge', action='store_true', help='check each try with yes/no questions to Claude (needs ANTHROPIC_API_KEY)')
    ap.add_argument('--judge-model', default='claude-opus-5-5', help='judge model (default claude-opus-5-5; claude-haiku-5-5 is cheaper)')
    ap.add_argument('--background', choices=['auto', 'transparent', 'magenta'], default='auto',
                    help='single poses: ask the Images API for a transparent background (auto: yes, falling back to magenta if the model refuses it)')
    ap.add_argument('--dry-run', action='store_true', help='build guides and prompts, call nothing')
    args = ap.parse_args()
    args.work = args.work or args.workdir or args.out_sheet + '.work'
    os.makedirs(args.work, exist_ok=True)
    if bool(args.fighter) != bool(args.keys): sys.exit('--fighter and --keys go together')
    if args.judge and not os.environ.get('ANTHROPIC_API_KEY') and not args.dry_run: sys.exit('--judge needs ANTHROPIC_API_KEY')
    # fail before any request if the model isn't set or isn't known; a missing key only fails once a request is needed,
    # so re-snapping from cached requests still works with no key
    args.m = providers.Model('dry-run', 'codex', None) if args.dry_run and not args.model else providers.resolve(args.model, args.models_file)
    if args.m.max_refs < 2: sys.exit(f'{args.m.name} takes {args.m.max_refs} input image; paint.py sends at least 2 (character and pose)')
    (pose_mode if args.keys else batch_mode)(args)


if __name__ == '__main__': main()
