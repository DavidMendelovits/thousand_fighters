#!/usr/bin/env python3
"""Run-cycle test: paint Faro's 8 run frames with one or more image models and compare the loops.

    python3 runtest/paint_run.py --models gemini-nano-banana-2.1,gpt-image-2 [--quality high] [--dry-run]

Needs GEMINI_API_KEY for gemini-* models and OPENAI_API_KEY for gpt-image-* (or the codex CLI, as paint.py).
Writes to runtest/out/: <model>/ (cached requests, keyed cells), <model>-strip.png, <model>.gif, and compare.gif
(rig on top, one row per model). Resumable: a frame already painted is not requested again.

Each frame is one request carrying: Faro's idle cell from fighters/faro.png (who he is), the frame painted just
before it (so the loop stays on model; frame 1 gets none), and the colour-coded rig guide for the frame (the pose).
The rig sets the pose; the model only paints it. Every frame is keyed, then snapped onto the rig's feet line at one
scale per model (the median of the frames' own fits), so the loop doesn't pulse in size.
"""
import argparse, json, os, statistics, sys
from types import SimpleNamespace
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
from PIL import Image
import paint as P

def prompt(c, desc, has_prev, n):
    g = 3 if has_prev else 2
    return (f"{g} images are attached. Image 1 is the character reference. "
            + ("Image 2 is the same character in the previous frame of this run; keep the face, outfit, colours, proportions and size identical to it. " if has_prev else '')
            + f"Image {g} is the pose guide: a stick figure on magenta, side view facing right (the black nose points the way the character faces). "
            "Red is the character's left arm, the one nearer the viewer; blue is the right arm, farther from the viewer; "
            "green is the left leg, nearer; orange is the right leg, farther; grey is the torso and head. "
            f"Draw one 1024x1024 image: the SAME character as image 1 (character: {desc}), full body, side view facing right, running, "
            f"in exactly the pose of image {g}. This is {c['usedBy'][0].replace('8', str(n))}. {c['sentence']} "
            "Match each limb's angle and where each hand and foot ends up, and match the figure's size and position in the frame, feet at the guide's height. "
            "Do not mirror the pose or swap left and right limbs. Keep the whole figure inside the frame. " + P.STYLE)

def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--models', default='gemini-nano-banana-2.1,gpt-image-2')
    ap.add_argument('--fighter', default=os.path.join(ROOT, 'fighters/faro.json'))
    ap.add_argument('--sheet', default=os.path.join(ROOT, 'fighters/faro.png'), help='painted sheet; its idle cell is the character reference')
    ap.add_argument('--run', default=os.path.join(HERE, 'faro.run.json'), help='output of runposes.ts')
    ap.add_argument('--out', default=os.path.join(HERE, 'out'))
    ap.add_argument('--desc', help='character description (default: the fighter bio\'s first two sentences)')
    ap.add_argument('--quality', help='OpenAI image quality (low, medium, high)')
    ap.add_argument('--dry-run', action='store_true', help='build guides and prompts, call nothing')
    a = ap.parse_args()
    data = json.load(open(a.run)); cells = data['cells']; n = len(cells)
    desc = a.desc or '. '.join(data['bio'].split('. ')[:2]).rstrip('.') + '.'
    sheet = Image.open(a.sheet).convert('RGBA')
    os.makedirs(a.out, exist_ok=True)
    ref = f'{a.out}/ref_idle0.png'; P.on_magenta(P.cell_of(sheet, data['idleIndex'])).save(ref)
    guides = []
    for c in cells:
        gp = f'{a.out}/guide_{c["key"]}.png'; P.guide_image(c).save(gp); guides.append(gp)
    rows = [[P.guide_image(c, P.CELL).convert('RGBA') for c in cells]]

    for model in [m.strip() for m in a.models.split(',') if m.strip()]:
        work = f'{a.out}/{model}'; os.makedirs(work, exist_ok=True)
        args = SimpleNamespace(model=model, quality=a.quality, dry_run=a.dry_run, work=work, bg='magenta')
        if not a.dry_run: P.provider(args)  # fail early on a missing key
        P.RUN.clear(); figs = []
        for i, c in enumerate(cells):
            got = f'{work}/frame_{i}.png'; prev = f'{work}/prev_{i}.png'
            if i and os.path.exists(f'{work}/frame_{i - 1}.png'):
                Image.open(f'{work}/frame_{i - 1}.png').convert('RGB').resize((P.POSE, P.POSE)).save(prev)
            has_prev = bool(i) and (os.path.exists(prev) or a.dry_run)
            images = [ref, prev, guides[i]] if has_prev else [ref, guides[i]]
            if not os.path.exists(got):
                print(f'{model}: frame {i + 1}/{n}…', flush=True)
                P.request(prompt(c, desc, has_prev, n), images, got, '1024x1024', args, f'{model} frame {i}')
            if not os.path.exists(got): continue  # dry run
            fig = P.despeck(P.key(Image.open(got).convert('RGBA').resize((P.POSE, P.POSE), Image.LANCZOS)))
            want = P.key(Image.open(guides[i])).getbbox(); have = fig.getbbox()
            if not have: print(f'  frame {i + 1}: empty'); continue
            fig = fig.crop(have)
            figs.append((i, fig, want, max(want[2] - want[0], want[3] - want[1]) / max(fig.width, fig.height)))
        if a.dry_run:
            json.dump(P.RUN, open(f'{work}/dry_run.json', 'w'), indent=1)
            print(f'{model}: dry run, {len(P.RUN.get("requests", []))} requests would be sent; prompts in {work}/dry_run.json'); continue
        s = statistics.median(f[3] for f in figs)
        row = [Image.new('RGBA', (P.CELL, P.CELL), (0, 0, 0, 0)) for _ in cells]
        for i, fig, want, own in figs:
            if abs(own / s - 1) > 0.25: print(f'  frame {i + 1}: own fit {own / s:.2f}x the median, check it')
            row[i] = P.place(fig, want, s, P.POSE).resize((P.CELL, P.CELL), Image.LANCZOS)
        strip = Image.new('RGBA', (P.CELL * n, P.CELL), (0, 0, 0, 0))
        for i, im in enumerate(row): strip.alpha_composite(im, (i * P.CELL, 0))
        strip.save(f'{a.out}/{model}-strip.png')
        gif(row, f'{a.out}/{model}.gif'); rows.append(row)
        print(f'{model}: wrote {model}-strip.png and {model}.gif (scale {s:.3f})')

    if len(rows) > 1:  # rig on top, one row per model, all frames in step
        frames = []
        for i in range(n):
            f = Image.new('RGBA', (P.CELL, P.CELL * len(rows)), (40, 44, 52, 255))
            for r, row in enumerate(rows): f.alpha_composite(row[i], (0, r * P.CELL))
            frames.append(f)
        gif(frames, f'{a.out}/compare.gif'); print('wrote compare.gif')

def gif(frames, path, ms=83):
    bg = [Image.alpha_composite(Image.new('RGBA', f.size, (40, 44, 52, 255)), f).convert('RGB') for f in frames]
    bg[0].save(path, save_all=True, append_images=bg[1:], duration=ms, loop=0)

if __name__ == '__main__': main()
