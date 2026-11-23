#!/usr/bin/env python3
"""Paint a fighter's pose sheet with an image model.

    python3 paint.py <rig_sheet.png> <out_sheet.png> "<character description>" [workdir]

rig_sheet.png is the studio's "Download pose sheet" (256px cells, 8 columns, magenta background).
Each batch of 6 poses goes to the model with the character reference; every painted cell is keyed
and snapped back onto the rig's position and size, so anchors and hitboxes still line up.
Resumable: finished batches are cached in workdir.

The provider is paint(): (prompt, [input images], out_path). Swap that one function to change models.
ponytail: sequential and codex-only; add providers/parallelism when a batch run is too slow.
"""
import base64, glob, json, os, statistics, subprocess, sys, time
import numpy as np
from PIL import Image
from scipy import ndimage

CELL, COLS, BIG = 256, 8, 512
MAGENTA = (255, 0, 255)
STYLE = ("Style: clean hand-drawn 2D fighting-game sprite, bold dark outline, flat cel shading, readable silhouette. "
         "No fire, glow, motion lines, shadows, text or borders. Background is flat pure magenta #ff00ff everywhere.")


def paint(prompt, images, out):
    """Provider seam: (prompt, input image paths, output path).
    With OPENAI_API_KEY set this calls the Images API (gpt-image-1); otherwise the codex CLI (CODEX_MODEL to pick its model)."""
    key_ = os.environ.get('OPENAI_API_KEY')
    if key_:
        model = os.environ.get('OPENAI_IMAGE_MODEL', 'gpt-image-1')
        cmd = ['curl', '-sS', '--max-time', '600', '-H', f'Authorization: Bearer {key_}']
        if images:  # edits takes multipart; generations only takes JSON
            cmd += ['-F', f'model={model}', '-F', f'prompt={prompt}', '-F', 'size=1536x1024', 'https://api.openai.com/v1/images/edits'] + [x for i in images for x in ('-F', f'image[]=@{i}')]
        else:
            cmd += ['-H', 'Content-Type: application/json', '-d', json.dumps({'model': model, 'prompt': prompt, 'size': '1536x1024'}), 'https://api.openai.com/v1/images/generations']
        res = json.loads(subprocess.run(cmd, capture_output=True, text=True).stdout or '{}')
        if 'data' not in res: raise RuntimeError(str(res.get('error', res))[:300])
        open(out, 'wb').write(base64.b64decode(res['data'][0]['b64_json'])); return
    start = time.time() - 3
    args = ['codex', 'exec', '--sandbox', 'workspace-write', '--skip-git-repo-check']
    if os.environ.get('CODEX_MODEL'): args += ['--model', os.environ['CODEX_MODEL']]
    for i in images: args += ['-i', i]
    run = subprocess.run(args, input=prompt + '\nGenerate exactly one image with your image generation tool. Do not write code or other files.',
                         text=True, capture_output=True, timeout=600)
    new = [f for f in glob.glob(os.path.expanduser('~/.codex/generated_images/**/*.png'), recursive=True) if os.path.getmtime(f) >= start]
    if not new: raise RuntimeError('codex produced no image: ' + (run.stdout + run.stderr)[-300:].strip())
    Image.open(max(new, key=os.path.getmtime)).convert('RGB').save(out)


def key(im):
    """Magenta -> transparent, with the magenta fringe pulled out of edge pixels."""
    im = im.convert('RGBA'); px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, _ = px[x, y]
            m = min(r, b) - g  # how magenta this pixel is
            if m > 90: px[x, y] = (0, 0, 0, 0)
            elif m > 30: px[x, y] = (r - m // 2, g, b - m // 2, 255)
    return im


def despeck(im, keep=0.05):  # Faro's only detached piece over 0.5% was a 4.3% stray fragment
    """Drop detached blobs smaller than `keep` of the figure, so stray fragments don't move the box."""
    a = np.array(im); lab, n = ndimage.label(a[..., 3] > 0)
    if n < 2: return im
    sizes = ndimage.sum(np.ones(lab.shape), lab, range(1, n + 1))
    a[np.isin(lab, 1 + np.flatnonzero(sizes < keep * sizes.sum()))] = 0
    return Image.fromarray(a)


def main():
    rig_path, out_path, desc = sys.argv[1], sys.argv[2], sys.argv[3]
    work = sys.argv[4] if len(sys.argv) > 4 else out_path + '.work'
    os.makedirs(work, exist_ok=True)
    rig = Image.open(rig_path).convert('RGB')
    cell = lambda i: rig.crop(((i % COLS) * CELL, (i // COLS) * CELL, (i % COLS + 1) * CELL, (i // COLS + 1) * CELL))
    total = COLS * rig.height // CELL
    cells = 1 + max(i for i in range(total) if cell(i).getcolors(1) is None)  # last cell that is not blank background

    ref = f'{work}/ref.png'
    if not os.path.exists(ref):
        print('reference…', flush=True)
        paint(f"A single full-body character design for a 2D fighting game, standing in a fighting stance, side view facing right, centered. Character: {desc} {STYLE}", [], ref)

    sheet, figs = Image.new('RGBA', rig.size, (0, 0, 0, 0)), []
    for c in range(0, cells, 6):
        got = f'{work}/batch_{c:02d}.png'
        guide = Image.new('RGB', (BIG * 3, BIG * 2), MAGENTA)
        for k in range(6):
            if c + k < cells: guide.paste(cell(c + k).resize((BIG, BIG), Image.LANCZOS), ((k % 3) * BIG, (k // 3) * BIG))
        if not os.path.exists(got):
            print(f'batch {c // 6 + 1}/{-(-cells // 6)}…', flush=True)
            gp = f'{work}/guide_{c:02d}.png'; guide.save(gp)
            for attempt in (1, 2):
                try:
                    paint("Two images are attached. Image 1 is the character reference. Image 2 is a pose guide: a 3x2 grid of six mannequin poses on magenta. "
                          "Make a 1536x1024 image with the same 3x2 layout. In each cell draw the SAME character as image 1 — same face, hair, outfit, colours and proportions — "
                          "full body, side view facing right, in exactly that cell's mannequin pose: same limb angles, same size, same position in the cell, feet at the same height. "
                          "Keep every figure fully inside its own cell. Empty magenta cells stay empty. " + STYLE, [ref, gp], got)
                    break
                except Exception as e:
                    print('  retry:', e, flush=True)
                    if attempt == 2: raise
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

    # One scale for the whole character: the median of each pose's own fit, so a pose with a stray
    # fragment or an oversized limb keeps the same body size instead of shrinking or swelling.
    # ponytail: median of bbox fits; measure a stable feature (head size) if poses still pulse.
    s = statistics.median(f[3] for f in figs)
    for i, fig, want, own in figs:
        if abs(own / s - 1) > 0.25: print(f'  cell {i}: own fit {own / s:.2f}x the median, check it', flush=True)
        fig = fig.resize((max(1, round(fig.width * s)), max(1, round(fig.height * s))), Image.LANCZOS)
        tile = Image.new('RGBA', (BIG, BIG), (0, 0, 0, 0))  # same feet line, same horizontal centre as the rig
        tile.paste(fig, (round((want[0] + want[2]) / 2 - fig.width / 2), want[3] - fig.height))
        sheet.paste(tile.resize((CELL, CELL), Image.LANCZOS), ((i % COLS) * CELL, (i // COLS) * CELL))
    sheet.save(out_path)
    print('wrote', out_path, f'(scale {s:.3f})')


if __name__ == '__main__': main()
