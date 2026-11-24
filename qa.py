#!/usr/bin/env python3
"""Check a painted pose sheet against its rig, cell by cell.

    python3 qa.py <rig_sheet.png> <painted_sheet.png> <fighter.json> [--keys a,b] [--judge] [--out DIR]
    python3 qa.py ... --calibrate art/faro-qa-labels.json [--judge]

Free checks, every cell: empty, clipped at the cell edge, magenta fringe left from keying, detached pieces,
size against the rest of the sheet, colours against the rest of the sheet, and how much of the rig's figure the
painting covers (a hard pose painted as something else leaves big parts of the rig bare).

Those catch broken cells. They do not reliably catch a pose painted as the plain stance: Faro's coat covers too
much of the rig either way. --judge adds that: Claude answers yes/no questions about each painted cell whose right
answers the rig already knows (posedata.ts), e.g. "is a hand above the head?" for a raised-arms pose. It costs
money (ANTHROPIC_API_KEY); --judge-model claude-haiku-5-5 is the cheap option.

Writes <out>/qa.json and <out>/contact.png: each rig cell beside its painted cell, failing cells outlined red.
--calibrate runs the same checks on cells a person already labelled right or wrong, and reports how often they agree.
"""
import argparse, base64, io, json, os, statistics, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from paint import CELL, COLS, cell_of, key, pose_data

SIZE_TOL, LOST_MAX, FRINGE_MAX = 0.4, 0.22, 0.005


def alpha(im):
    return np.array(im.convert('RGBA'))[..., 3] > 40


def rig_mask(rig_cell):
    return np.array(key(rig_cell.convert('RGB')))[..., 3] > 0


def area_ratio(painted, rig_cell):
    """Painted figure area over the rig figure's area: roughly constant across a sheet whose cells share one scale."""
    r = rig_mask(rig_cell).sum()
    return alpha(painted).sum() / r if r else 0.0


def hist(painted):
    a = np.array(painted.convert('RGBA')); px = a[a[..., 3] > 200][:, :3] // 64
    h = np.bincount(px[:, 0] * 16 + px[:, 1] * 4 + px[:, 2], minlength=64).astype(float)
    return h / max(1, h.sum())


def structural(painted, rig_cell, ctx=None):
    """Problems with one painted 256px cell, as short strings. ctx: {'ratio': median area ratio, 'hist': median colours}."""
    a = np.array(painted.convert('RGBA')).astype(int); m = a[..., 3] > 40; n = m.sum()
    if n < 0.02 * CELL * CELL: return ['empty']
    out = []
    edge = np.concatenate([m[:2].ravel(), m[-2:].ravel(), m[:, :2].ravel(), m[:, -2:].ravel()])
    if edge.sum() > 3: out.append('touches cell edge')
    mag = m & ((np.minimum(a[..., 0], a[..., 2]) - a[..., 1]) > 40)
    if mag.sum() > FRINGE_MAX * n: out.append('magenta fringe')
    lab, k = ndimage.label(m)
    if k > 1:
        sizes = ndimage.sum(np.ones(m.shape), lab, range(1, k + 1))
        if (sizes > 0.02 * n).sum() > 1: out.append(f'{int((sizes > 0.02 * n).sum())} detached pieces')
    g = rig_mask(rig_cell)
    if g.any():
        lost = (g & (ndimage.distance_transform_edt(~m) > 12)).sum() / g.sum()
        if lost > LOST_MAX: out.append(f'rig {lost:.0%} uncovered')
    if ctx and ctx.get('ratio'):
        r = area_ratio(painted, rig_cell) / ctx['ratio']
        if abs(r - 1) > SIZE_TOL: out.append(f'size {r:.2f}x the sheet')
    if ctx and ctx.get('hist') is not None:
        d = np.abs(hist(painted) - ctx['hist']).sum()
        if d > ctx.get('hist_max', 9): out.append(f'colours off ({d:.2f})')
    return out


def sheet_context(rig, sheet, cells, skip=()):
    """Median size ratio and colours over the cells not being judged, so one bad cell can't set the bar."""
    use = [c for c in cells if c['key'] not in skip and cell_of(sheet, c['index']).getbbox()]
    ratios = [area_ratio(cell_of(sheet, c['index']), cell_of(rig, c['index'])) for c in use]
    hs = np.array([hist(cell_of(sheet, c['index'])) for c in use])
    med = np.median(hs, axis=0); d = np.abs(hs - med).sum(axis=1)
    mad = float(np.median(np.abs(d - np.median(d)))) or 0.01
    return {'ratio': statistics.median(ratios), 'hist': med, 'hist_max': float(np.median(d) + 6 * mad)}


SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['answers'], 'properties': {'answers': {
    'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['id', 'answer'],
                               'properties': {'id': {'type': 'string'}, 'answer': {'type': 'string', 'enum': ['yes', 'no', 'unclear']}}}}}}


def judge_request(painted, checks, model):
    """The Messages API request for one cell: the painted frame on light grey, and the rig's yes/no questions."""
    bg = Image.new('RGBA', painted.size, (235, 235, 235, 255)); bg.alpha_composite(painted.convert('RGBA'))
    buf = io.BytesIO(); bg.convert('RGB').resize((CELL * 2, CELL * 2), Image.LANCZOS).save(buf, 'PNG')
    qs = '\n'.join(f'- {c["id"]}: {c["q"]}' for c in checks)
    text = ("This is one frame from a 2D fighting-game sprite sheet. The character is drawn in side view, facing right. "
            "Answer each question about what is drawn in this image, judging the character's body and limbs (ignore props, coat tails and effects). "
            "Answer yes or no; answer unclear only if the image truly does not show it.\n" + qs)
    return dict(model=model, max_tokens=4000, output_config={'effort': 'low', 'format': {'type': 'json_schema', 'schema': SCHEMA}},
                messages=[{'role': 'user', 'content': [
                    {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png', 'data': base64.b64encode(buf.getvalue()).decode()}},
                    {'type': 'text', 'text': text}]}])


def judge(painted, checks, model):
    """Ask Claude the rig's yes/no questions about one painted cell. Returns each check with the answer and whether it matched."""
    import anthropic
    client, req = anthropic.Anthropic(), judge_request(painted, checks, model)
    if model.startswith('claude-opus-5-5'):  # Haiku 5.5 takes no fallbacks
        res = client.beta.messages.create(**req, betas=['server-side-fallback-2026-07-01'], fallbacks='default')
    else:
        res = client.messages.create(**req)
    if res.stop_reason == 'refusal':
        return [{**c, 'answer': 'refused', 'match': False} for c in checks]
    got = {a['id']: a['answer'] for a in json.loads(next(b.text for b in res.content if b.type == 'text'))['answers']}
    return [{'id': c['id'], 'q': c['q'], 'expect': 'yes' if c['expect'] else 'no', 'answer': got.get(c['id'], 'missing'),
             'match': got.get(c['id']) == ('yes' if c['expect'] else 'no')} for c in checks]


def contact(rig, sheet, rows, path, scale=0.5):
    """Rig cell beside painted cell for every checked key; failing cells outlined red, the key written under each pair."""
    t = round(CELL * scale); per = 6; lab = 16
    W, H = per * (2 * t + 8), -(-len(rows) // per) * (t + lab + 6)
    im = Image.new('RGB', (W, H), (34, 34, 40)); g = ImageDraw.Draw(im)
    for n, r in enumerate(rows):
        x, y = (n % per) * (2 * t + 8), (n // per) * (t + lab + 6)
        for k, src in enumerate((cell_of(rig, r['index']).convert('RGBA'), cell_of(sheet, r['index']))):
            tile = Image.new('RGBA', (CELL, CELL), (60, 60, 68, 255) if k else (255, 0, 255, 255)); tile.alpha_composite(src.convert('RGBA'))
            im.paste(tile.convert('RGB').resize((t, t), Image.LANCZOS), (x + k * t, y))
        bad = not r['ok']
        g.rectangle([x + t, y, x + 2 * t - 1, y + t - 1], outline=(230, 50, 50) if bad else (60, 60, 68), width=3 if bad else 1)
        g.text((x + 2, y + t + 2), (r['key'] + (': ' + ', '.join(r['problems'] + r.get('wrong', [])) if bad else ''))[:46], fill=(255, 120, 120) if bad else (200, 200, 200))
    im.save(path)


def check(rig, sheet, data, keys, args):
    cells = [c for c in data['cells'] if not keys or c['key'] in keys]
    ctx = sheet_context(rig, sheet, data['cells'], skip=keys or ())
    rows = []
    for c in cells:
        painted = cell_of(sheet, c['index'])
        problems = structural(painted, cell_of(rig, c['index']), ctx)
        verdict = judge(painted, c['checks'], args.judge_model) if args.judge and c['checks'] and problems != ['empty'] else None
        wrong = [a['id'] for a in verdict or [] if not a['match']]
        rows.append({'index': c['index'], 'key': c['key'], 'ok': not problems and not wrong, 'problems': problems, 'judge': verdict, 'wrong': wrong})
        if not rows[-1]['ok']: print(f"✘ {c['key']}: {', '.join(problems + wrong)}", flush=True)
    return rows


def main():
    ap = argparse.ArgumentParser(description='Check a painted pose sheet against its rig.')
    ap.add_argument('rig_sheet'); ap.add_argument('painted_sheet'); ap.add_argument('fighter')
    ap.add_argument('--keys', help='only these sheet keys (comma-separated)')
    ap.add_argument('--judge', action='store_true', help='ask Claude the rig\'s yes/no pose questions (needs ANTHROPIC_API_KEY, costs money)')
    ap.add_argument('--judge-model', default='claude-opus-5-5')
    ap.add_argument('--calibrate', help='JSON of labelled cells {"right": [...], "wrong": [...]}: report agreement with the labels')
    ap.add_argument('--out', help='output dir (default <painted_sheet>.qa)')
    args = ap.parse_args()
    if args.judge and not os.environ.get('ANTHROPIC_API_KEY'): sys.exit('--judge needs ANTHROPIC_API_KEY')
    out = args.out or os.path.splitext(args.painted_sheet)[0] + '.qa'; os.makedirs(out, exist_ok=True)
    rig, sheet = Image.open(args.rig_sheet).convert('RGB'), Image.open(args.painted_sheet).convert('RGBA')
    data = pose_data(args.fighter)
    labels = json.load(open(args.calibrate)) if args.calibrate else None
    keys = [k for k in (args.keys or '').split(',') if k] or (labels['right'] + labels['wrong'] if labels else None)
    rows = check(rig, sheet, data, keys, args)
    report = {'rig': args.rig_sheet, 'sheet': args.painted_sheet, 'judge': args.judge_model if args.judge else None,
              'failing': [r['key'] for r in rows if not r['ok']], 'cells': rows}
    if labels:
        right, wrong = set(labels['right']), set(labels['wrong'])
        caught = [r['key'] for r in rows if r['key'] in wrong and not r['ok']]
        false = [r['key'] for r in rows if r['key'] in right and not r['ok']]
        report['calibration'] = {'wrong_caught': caught, 'wrong_missed': sorted(wrong - set(caught)), 'right_flagged': false}
        print(f'calibration: caught {len(caught)}/{len(wrong)} wrong cells, flagged {len(false)}/{len(right)} right cells')
        print('  missed:', ', '.join(sorted(wrong - set(caught))) or 'none', '| false alarms:', ', '.join(false) or 'none')
    json.dump(report, open(f'{out}/qa.json', 'w'), indent=1)
    contact(rig, sheet, rows, f'{out}/contact.png')
    print(f'{len(rows) - len(report["failing"])}/{len(rows)} cells pass; wrote {out}/qa.json and {out}/contact.png')


if __name__ == '__main__': main()
