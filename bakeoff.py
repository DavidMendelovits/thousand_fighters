#!/usr/bin/env python3
"""Paint the same poses on several image models and compare them.

    python3 bakeoff.py <rig_sheet.png> <painted_sheet.png> <fighter.json> "<character description>" \\
        --models gpt-image-2.5-sunburst,nano-banana-2,flux-2-pro [--keys hit,jp.w,dive.w] [--tries 1] [--judge] [--dry-run]

For each model it copies the painted sheet, repaints the named cells with paint.py's single-pose mode (same
character reference, nearest-pose reference, colour-coded guide and prompt for every model), and lets paint.py's
normalizer and qa.py's checks grade the result. Nothing about the models is special-cased here: what differs
lives in image_models.json.

Writes <out>/report.md, report.json and contact.png (rig, current sheet, then one column per model; failing
cells outlined red). Default out: bakeoff/<fighter>-<date>. Resumable: each model's tries are cached in
<out>/<model>/work, so a re-run only pays for what's missing.

It costs money: at most cells x tries requests per model, at the cost in image_models.json. It prints that
estimate and stops unless you pass --yes (free models such as fixture need no --yes). --dry-run builds
every guide and prompt and sends nothing. --judge adds Claude's yes/no pose check (about $0.02 a try on
claude-opus-5-5); without it only the free structural checks grade, and they miss a pose painted as the stance.
"""
import argparse, datetime, json, os, shutil, subprocess, sys, time
from PIL import Image, ImageDraw

import providers
from paint import CELL, cell_of, pose_data

HERE = os.path.dirname(os.path.abspath(__file__))
# Hard and easy Faro poses: dive.w and swing.w failed every try on Nov 23; hit, jp.w and tend.s came back right.
DEFAULT_KEYS = 'hit,jp.w,dive.w,tend.s,swing.w'
JUDGE_COST = 0.02  # per try on claude-opus-5-5 (HANDOFF.md)


def run_model(name, m, args, out):
    d = os.path.join(out, name); os.makedirs(d, exist_ok=True)
    sheet = os.path.join(d, 'sheet.png')
    if not os.path.exists(sheet): shutil.copy(args.painted_sheet, sheet)
    cmd = [sys.executable, os.path.join(HERE, 'paint.py'), args.rig_sheet, sheet, args.desc, '--fighter', args.fighter,
           '--keys', args.keys, '--model', name, '--tries', str(args.tries), '--work', os.path.join(d, 'work')]
    if args.models_file: cmd += ['--models-file', args.models_file]
    if args.judge: cmd += ['--judge', '--judge-model', args.judge_model]
    if args.dry_run: cmd += ['--dry-run']
    t = time.time()
    r = subprocess.run(cmd, capture_output=True, text=True)
    open(os.path.join(d, 'paint.log'), 'w').write(r.stdout + r.stderr)
    res = {'model': name, 'provider': m.label, 'ok_run': r.returncode == 0, 'wall_seconds': round(time.time() - t, 1)}
    if r.returncode:
        res['error'] = (r.stderr or r.stdout).strip().splitlines()[-1][:300] if (r.stderr or r.stdout).strip() else f'exit {r.returncode}'
        print(f'  {name}: failed: {res["error"]}', flush=True); return res
    if args.dry_run:
        res['dry_run'] = (r.stdout.strip().splitlines() or [''])[-1]; return res
    log = json.load(open(os.path.join(d, 'sheet.paint.json')))
    runs = json.load(open(os.path.join(d, 'work', 'run.json')))['results']
    sent = sum(e.get('sent', 0) for e in log)
    cells = {k: {'ok': v.get('ok', False), 'kept': v.get('kept'), 'tries': len(v['tries']),
                 'problems': (next((t for t in v['tries'] if t['try'] == v.get('kept')), {}) or {}).get('problems', []),
                 'wrong': (next((t for t in v['tries'] if t['try'] == v.get('kept')), {}) or {}).get('wrong', [])}
             for k, v in runs.items()}
    tries = sum(c['tries'] for c in cells.values())
    res.update({'passed': sum(c['ok'] for c in cells.values()), 'cells': cells, 'tries': tries, 'sent': sent,
                'paint_seconds': round(sum(e.get('paint_seconds', 0) for e in log), 1),
                'cost': round(tries * m.cost, 2) if m.cost is not None else None, 'cost_source': m.cost_source,
                'background': log[-1].get('background'), 'sheet': sheet})
    if args.judge: res['judge_cost'] = round(tries * JUDGE_COST, 2)
    print(f'  {name}: {res["passed"]}/{len(cells)} pass, {tries} tries, {res["paint_seconds"]}s painting', flush=True)
    return res


def contact(rig, current, results, keys, cells, path, t=128):
    """One row per pose: rig, current sheet, then each model. Failing cells outlined red."""
    cols = [('rig', rig, None), ('current', current, None)] + [(r['model'], Image.open(r['sheet']).convert('RGBA'), r) for r in results if r.get('sheet')]
    head, lab, gap = 18, 14, 6
    W, H = len(cols) * (t + gap) + 70, head + len(keys) * (t + lab + gap)
    im = Image.new('RGB', (W, H), (34, 34, 40)); g = ImageDraw.Draw(im)
    for n, (name, _, _) in enumerate(cols): g.text((70 + n * (t + gap), 3), name[:20], fill=(220, 220, 220))
    for row, k in enumerate(keys):
        y = head + row * (t + lab + gap); g.text((4, y + t // 2), k, fill=(200, 200, 200))
        for n, (name, sheet, r) in enumerate(cols):
            x = 70 + n * (t + gap)
            tile = Image.new('RGBA', (CELL, CELL), (255, 0, 255, 255) if name == 'rig' else (60, 60, 68, 255))
            tile.alpha_composite(cell_of(sheet, cells[k]).convert('RGBA'))
            im.paste(tile.convert('RGB').resize((t, t), Image.LANCZOS), (x, y))
            if r:
                c = r['cells'].get(k, {}); bad = not c.get('ok')
                g.rectangle([x, y, x + t - 1, y + t - 1], outline=(230, 50, 50) if bad else (70, 170, 90), width=3 if bad else 1)
                g.text((x + 2, y + t + 1), (', '.join(c.get('problems', []) + c.get('wrong', [])) or 'pass')[:22],
                       fill=(255, 120, 120) if bad else (150, 220, 160))
    im.save(path)


def report_md(results, args, n):
    money = lambda v: '?' if v is None else f'${v:.2f}'
    lines = [f'# Bake-off: {os.path.basename(args.fighter)}, {n} poses ({args.keys}), up to {args.tries} tries each',
             '', f'Judge: {args.judge_model if args.judge else "off (structural checks only)"}', '',
             '| Model | Provider | Pass | Tries | Est. cost | Painting time | Background | Failing |', '|---|---|---|---|---|---|---|---|']
    for r in results:
        if not r.get('cells'):
            lines.append(f'| {r["model"]} | {r["provider"]} | n/a | | | | | {r.get("error") or r.get("dry_run", "")} |'); continue
        failing = ', '.join(k for k, c in r['cells'].items() if not c['ok']) or 'none'
        lines.append(f'| {r["model"]} | {r["provider"]} | {r["passed"]}/{len(r["cells"])} | {r["tries"]} | {money(r["cost"])} '
                     f'| {r["paint_seconds"]}s | {r["background"]} | {failing} |')
    lines += ['', 'Cost is tries x the per-image estimate in image_models.json (sources below); the judge, if on, is extra.',
              'Painting time sums the requests that reached each model, across resumed runs.', '']
    lines += [f'- {r["model"]}: {r.get("cost_source") or "no cost source"}' for r in results if r.get('cells')]
    return '\n'.join(lines) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('rig_sheet'); ap.add_argument('painted_sheet'); ap.add_argument('fighter'); ap.add_argument('desc')
    ap.add_argument('--models', required=True, help='comma-separated names from image_models.json (or provider:model id)')
    ap.add_argument('--keys', default=DEFAULT_KEYS, help=f'sheet cells to paint (default {DEFAULT_KEYS})')
    ap.add_argument('--tries', type=int, default=1, help='tries per cell per model (default 1: compares first attempts)')
    ap.add_argument('--judge', action='store_true'); ap.add_argument('--judge-model', default='claude-opus-5-5')
    ap.add_argument('--models-file'); ap.add_argument('--out')
    ap.add_argument('--dry-run', action='store_true'); ap.add_argument('--yes', action='store_true', help='spend the estimated amount')
    args = ap.parse_args()

    names = [x.strip() for x in args.models.split(',') if x.strip()]
    models = {n: providers.resolve(n, args.models_file) for n in names}
    keys = [k.strip() for k in args.keys.split(',') if k.strip()]
    data = pose_data(args.fighter); cells = {c['key']: c['index'] for c in data['cells']}
    bad = [k for k in keys if k not in cells]
    if bad: sys.exit(f'not in this fighter\'s sheet: {", ".join(bad)}')
    out = args.out or os.path.join(HERE, 'bakeoff', f'{os.path.splitext(os.path.basename(args.fighter))[0]}-{datetime.date.today()}')
    os.makedirs(out, exist_ok=True)

    most = len(keys) * args.tries
    print(f'{len(keys)} cells x up to {args.tries} tries = at most {most} requests per model:')
    total, unknown = 0.0, []
    for n, m in models.items():
        est = None if m.cost is None else most * m.cost
        if est is None: unknown.append(n)
        else: total += est
        need = m.missing_key()
        print(f'  {n} ({m.label}): ' + ('cost unknown' if est is None else f'up to ${est:.2f}') + (f', needs {need}' if need else ''))
    if args.judge: total += len(models) * most * JUDGE_COST; print(f'  judge: up to ${len(models) * most * JUDGE_COST:.2f}')
    print(f'total: up to ${total:.2f}' + (f' plus {", ".join(unknown)}' if unknown else ''))
    paid = (total > 0 or unknown) and not args.dry_run
    if paid and not args.yes: sys.exit('nothing sent; pass --yes to spend that (cached tries in the out dir are free)')

    results = [run_model(n, m, args, out) for n, m in models.items()]
    json.dump({'when': datetime.datetime.now().astimezone().isoformat(timespec='seconds'), 'keys': keys, 'tries': args.tries,
               'judge': args.judge_model if args.judge else None, 'results': results}, open(f'{out}/report.json', 'w'), indent=1)
    open(f'{out}/report.md', 'w').write(report_md(results, args, len(keys)))
    if not args.dry_run:
        rig, cur = Image.open(args.rig_sheet).convert('RGB'), Image.open(args.painted_sheet).convert('RGBA')
        contact(rig, cur, results, keys, cells, f'{out}/contact.png')
    print(f'wrote {out}/report.md, report.json' + ('' if args.dry_run else ' and contact.png'))


if __name__ == '__main__': main()
