#!/usr/bin/env python3
"""Deterministic cleanup/export of generated 4x2 pose sheets; never draws art."""
import json
import argparse
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
JOBS = ROOT / 'artifacts/roster-oddities'
SIZE = (224, 192)
ANCHOR = (96, 176)

def clean(image):
    image = image.convert('RGBA')
    r, g, b, a = image.split()
    # Remove keyed backdrop including edge contamination, preserving dark outlines.
    dominant = ImageChops.darker(ImageChops.subtract(r, g), ImageChops.subtract(b, g))
    keep = dominant.point(lambda v: 0 if v > 65 else 255)
    image.putalpha(ImageChops.darker(a, keep))
    return image

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--jobs-dir',type=Path,default=JOBS)
    parser.add_argument('--output-root',type=Path,default=ROOT/'public/fighters')
    args=parser.parse_args()
    originals = {j['id']: j for j in json.loads((args.jobs_dir / 'source-jobs.json').read_text())}
    jobs = json.loads((args.jobs_dir / 'clean-jobs.json').read_text())
    contact = Image.new('RGB', (800, 400), '#151e26')
    draw = ImageDraw.Draw(contact)
    for n, job in enumerate(jobs):
        dst = args.output_root / job['id']
        if (dst / 'frameData.json').exists():
            print(f"{job['id']}: existing export retained")
            continue
        source = clean(Image.open(job['source']))
        w, h = source.size
        cells = [source.crop((c*w//4, r*h//2, (c+1)*w//4, (r+1)*h//2)) for r in range(2) for c in range(4)]
        bounds = [im.getbbox() for im in cells]
        if any(b is None for b in bounds): raise ValueError(f"Empty pose: {job['id']}")
        scale = 116 / (bounds[0][3] - bounds[0][1])
        frames = []
        warnings = []
        for i, (cell, box) in enumerate(zip(cells, bounds)):
            if box[0] < 4 or box[1] < 4 or box[2] > cell.width-4 or box[3] > cell.height-4:
                warnings.append(f'Pose {i}: inspect source cell edge')
            # Feet are the bottom opaque band, not the whole silhouette midpoint.
            feet = cell.getchannel('A').crop((0, max(0,box[3]-10), cell.width, box[3])).getbbox()
            pivot_x = (feet[0] + feet[2])/2
            scaled = cell.resize((round(cell.width*scale),round(cell.height*scale)), Image.Resampling.NEAREST)
            frame = Image.new('RGBA', SIZE)
            x = ANCHOR[0] - round(pivot_x*scale)
            y = ANCHOR[1] - round(box[3]*scale)
            sb = scaled.getbbox()
            if x+sb[0] < 2 or x+sb[2] > SIZE[0]-2 or y+sb[1] < 2:
                raise ValueError(f'Pose exceeds shared canvas: {job["id"]}/{i}')
            frame.alpha_composite(scaled,(x,y))
            frames.append(frame)
        # One palette across all poses, no frame-local color pumping.
        palette_source = Image.new('RGB',(SIZE[0]*8,SIZE[1]), '#151e26')
        for i,frame in enumerate(frames): palette_source.paste(frame,(i*SIZE[0],0),frame)
        palette = palette_source.quantize(colors=48, method=Image.Quantize.MEDIANCUT)
        for i,frame in enumerate(frames):
            alpha = frame.getchannel('A')
            frame = frame.convert('RGB').quantize(palette=palette,dither=Image.Dither.NONE).convert('RGBA')
            frame.putalpha(alpha)
            frames[i] = frame
        (dst/'sprites/poses').mkdir(parents=True, exist_ok=True)
        metadata=[]
        for i,frame in enumerate(frames):
            file=f'sprites/poses/pose_{i+1:03}.png'
            frame.save(dst/file)
            metadata.append({'file':file,'width':SIZE[0],'height':SIZE[1],'anchor':{'x':ANCHOR[0],'y':ANCHOR[1]}})
        rows = {'base':list(range(8)), 'punch':[1,2,0], 'kick':[1,3,0], 'special_1':[1,4,0], 'special_2':[1,4,0], 'grab':[1,5,6], 'throw':[1,5,6], 'crouch':[1], 'block':[0], 'jump':[1,3], 'walk_forward':[0,1,0], 'walk_back':[0,1,0]}
        frame_data={'anchorConvention':'Feet pivot; one scale across all eight source poses. Attached extensions rendered separately.', 'frames':{key:[metadata[i] for i in indices] for key,indices in rows.items()}}
        (dst/'frameData.json').write_text(json.dumps(frame_data,indent=2)+'\n')
        sheet=Image.new('RGBA',(SIZE[0]*4,SIZE[1]*2))
        for i,frame in enumerate(frames): sheet.alpha_composite(frame,((i%4)*SIZE[0],(i//4)*SIZE[1]))
        sheet.save(dst/'poses.png')
        frames[0].save(dst/'portrait.png')
        provenance={'generator':'built-in image_gen', 'sourceType':'generated-key-poses', 'notVideoGenerated':True, 'prompt':originals[job['id']]['prompt'], 'cleanup':'Built-in image edit replaced gradient with magenta, deterministic chroma removal, shared nearest-neighbor scale and 48-color palette.', 'scale':scale, 'warnings':warnings, 'status':'prototype-review', 'poseCount':8}
        (dst/'art-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
        (dst/'manifest.json').write_text(json.dumps({'id':job['id'],'artSource':'generated-key-poses','sheets':{'poses':'poses.png'},'sprites':{k:[m['file'] for m in v] for k,v in frame_data['frames'].items()}},indent=2)+'\n')
        x=(n%5)*160; y=(n//5)*200
        contact.paste(frames[0],(x-24,y-24),frames[0]);draw.text((x+8,y+170),originals[job['id']]['name'],fill='#eee8da')
        print(job['id'],f'{scale:.3f}',warnings)
    contact.save(args.jobs_dir/'roster-contact.png')

if __name__ == '__main__': main()
