"""Normalize API-generated poses with one scale, shared palette, and feet anchors."""
import json
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np
from scipy import ndimage
from compile_animation_clip import key_background

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'generated/david'
DEST = ROOT / 'public/fighters/david'
NAMES = ['base', 'punch', 'kick', 'juggle', 'sound', 'ink', 'cable', 'hurt', 'crouch']
SIZE, ANCHOR = (224, 192), (96, 176)
source_names = ['cable_cast' if name == 'cable' and (SOURCE/'cable_cast.png').exists() else name for name in NAMES]
images = [key_background(Image.open(SOURCE / f'{name}.png'), '#ff00ff', mode='chroma') for name in source_names]
# Body-only sources: discard tiny disconnected keying noise, never attached limbs/cord.
# Projectiles are authored separately and are not processed by this body filter.
for im in images:
    alpha = np.asarray(im.getchannel('A')).copy()
    labels, _ = ndimage.label(alpha > 0)
    counts = np.bincount(labels.ravel())
    alpha[counts[labels] < 1000] = 0
    im.putalpha(Image.fromarray(alpha))
bounds = [im.getbbox() for im in images]
scale = 116 / (bounds[0][3] - bounds[0][1])
frames, report = [], []
for name, im, box in zip(NAMES, images, bounds):
    if not box or min(box[0], box[1], im.width-box[2], im.height-box[3]) < 8:
        raise ValueError(f'Empty or source-clipped pose: {name}')
    feet = im.getchannel('A').crop((0, box[3]-12, im.width, box[3])).getbbox()
    pivot = (feet[0] + feet[2]) / 2
    small = im.resize((round(im.width*scale), round(im.height*scale)), Image.Resampling.NEAREST)
    x, y = ANCHOR[0]-round(pivot*scale), ANCHOR[1]-round(box[3]*scale)
    b = small.getbbox()
    if x+b[0] < 4 or x+b[2] > SIZE[0]-4 or y+b[1] < 4 or y+b[3] > SIZE[1]-4:
        raise ValueError(f'Clipped normalized pose: {name}')
    frame = Image.new('RGBA', SIZE)
    frame.alpha_composite(small, (x, y))
    frames.append(frame)
    report.append({'pose': name, 'sourceBounds': box, 'outputBounds': frame.getbbox(), 'clipped': False})
atlas = Image.new('RGB', (SIZE[0]*len(frames), SIZE[1]), '#18202a')
for i, frame in enumerate(frames): atlas.paste(frame, (i*SIZE[0], 0), frame)
palette = atlas.quantize(colors=48, method=Image.Quantize.MEDIANCUT)
metadata = {}
(DEST/'sprites/poses').mkdir(parents=True, exist_ok=True)
(DEST/'sheets').mkdir(exist_ok=True)
contact = Image.new('RGB', (SIZE[0]*3, SIZE[1]*3), '#18202a')
for i, (name, frame) in enumerate(zip(NAMES, frames)):
    alpha = frame.getchannel('A')
    frame = frame.convert('RGB').quantize(palette=palette, dither=Image.Dither.NONE).convert('RGBA')
    frame.putalpha(alpha)
    file = f'sprites/poses/{name}.png'
    frame.save(DEST/file)
    metadata[name] = {'file': file, 'width': SIZE[0], 'height': SIZE[1], 'anchor': {'x': ANCHOR[0], 'y': ANCHOR[1]}}
    contact.paste(frame, ((i%3)*SIZE[0], (i//3)*SIZE[1]), frame)
    ImageDraw.Draw(contact).text(((i%3)*SIZE[0]+8,(i//3)*SIZE[1]+8), name, fill='white')
contact.save(DEST/'pose-preview.png')
rows = {name: ['base', name, 'base'] for name in NAMES if name not in ('base', 'hurt', 'crouch')}
rows.update(base=['base'], hurt=['hurt'], crouch=['crouch'], block=['base'], jump=['crouch'], walk_forward=['base'], walk_back=['base'], dash_forward=['crouch'], dash_back=['crouch'], grab=['base','cable','base'], throw=['base','cable','base'])
frame_data = {'anchorConvention': 'Feet aligned; shared nearest-neighbor scale across every pose. Effects live separately.', 'frames': {row: [metadata[name] for name in names] for row,names in rows.items()}}
for row, names in rows.items():
    sheet = Image.new('RGBA', (SIZE[0]*len(names), SIZE[1]))
    (DEST/f'sprites/{row}').mkdir(exist_ok=True)
    for i, name in enumerate(names):
        im = Image.open(DEST/metadata[name]['file'])
        sheet.alpha_composite(im, (i*SIZE[0],0))
        file = f'sprites/{row}/{row}_{i+1:03}.png'
        im.save(DEST/file)
        frame_data['frames'][row][i] = {**metadata[name], 'file': file}
    sheet.save(DEST/f'sheets/{row}.png')
Image.open(DEST/metadata['base']['file']).save(DEST/'portrait.png')
(DEST/'sprites/base').mkdir(exist_ok=True)
# Workbench's image-to-video action uses this canonical reference path.
Image.open(DEST/metadata['base']['file']).save(DEST/'sprites/base/base_001.png')
for file, value in {
    'frameData.json': frame_data,
    'normalization-report.json': {'scale': scale, 'paletteColors': 48, 'poses': report, 'status': 'geometry-passed-visual-review-required'},
    'manifest.json': {'id': 'david', 'artSource': 'bfl-flux-2-klein-key-poses', 'sheets': {row:f'sheets/{row}.png' for row in rows}, 'sprites': {row:[m['file'] for m in ms] for row,ms in frame_data['frames'].items()}},
    'art-provenance.json': {'generator': 'BFL FLUX.2 Klein API', 'sourceType': 'reference-based-key-poses', 'videoDerived': False, 'limitation': 'FAL video generation blocked by exhausted balance. Walk/jump are placeholder key poses, not full motion cycles.', 'sourcePhotosPublished': False, 'attempts': [json.loads((SOURCE/f'{name}.json').read_text()) for name in source_names]},
}.items(): (DEST/file).write_text(json.dumps(value, indent=2)+'\n')
print(f'Normalized {len(frames)} poses. Global scale: {scale:.4f}. No edge clipping.')
