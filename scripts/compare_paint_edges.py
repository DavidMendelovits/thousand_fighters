"""Diagnostic only: compare pale boundary coverage, not an art acceptance gate.

Usage: python3 scripts/compare_paint_edges.py OLD_FRAMES NEW_FRAMES OUTPUT_DIR
Writes reproducible measurements and a matched-crop dark/grey/white review board.
"""
import json
import sys
from pathlib import Path
import numpy as np
from scipy import ndimage
from PIL import Image, ImageDraw


def measure(paths):
    pale_pixels = 0
    pale_coverage = 0.
    coverage = 0.
    for path in paths:
        p = np.asarray(Image.open(path).convert('RGBA')).astype(float)
        mask = p[:, :, 3] > 0
        boundary = mask & (ndimage.distance_transform_edt(mask) <= 3)
        pale = boundary & (p[:, :, :3].min(2) > 175) & (np.ptp(p[:, :, :3], axis=2) < 35)
        pale_pixels += int(pale.sum())
        pale_coverage += float((p[:, :, 3][pale] / 255).sum())
        coverage += float((p[:, :, 3] / 255).sum())
    return dict(frames=len(paths), paleEdgePixels=pale_pixels,
                paleEdgeCoverage=round(pale_coverage, 2), totalAlphaCoverage=round(coverage, 2))


def main(old, new, output):
    left, right = sorted(Path(old).glob('*.png')), sorted(Path(new).glob('*.png'))
    if not left or [p.name for p in left] != [p.name for p in right]:
        raise ValueError('Expected matching, nonempty frame sets')
    out = Path(output); out.mkdir(parents=True, exist_ok=True)
    a, b = measure(left), measure(right)
    report = dict(warning='Heuristic diagnostic: legitimate pale pigment can be counted. Not a quality gate.',
                  definition='RGB min > 175 and channel range < 35, within 3 pixels of positive-alpha boundary; coverage = sum(alpha/255).',
                  before=a, after=b,
                  paleCoverageReductionPercent=round(100*(1-b['paleEdgeCoverage']/max(1,a['paleEdgeCoverage'])), 2))
    (out/'edge-metrics.json').write_text(json.dumps(report, indent=2)+'\n')
    # Same crop across versions, poses and backgrounds: no pose-by-pose fitting.
    images = [(Image.open(a).convert('RGBA'), Image.open(b).convert('RGBA')) for a,b in zip(left,right)]
    boxes = [im.getbbox() for pair in images for im in pair]
    crop = (min(b[0] for b in boxes)-8, min(b[1] for b in boxes)-8,
            max(b[2] for b in boxes)+8, max(b[3] for b in boxes)+8)
    w,h = crop[2]-crop[0],crop[3]-crop[1]
    board = Image.new('RGB', (w*6,(h+24)*3), '#20252b'); draw=ImageDraw.Draw(board)
    for row,i in enumerate([0,11,len(images)-1]):
        for bg_index,bg in enumerate(['#121820','#808080','#ffffff']):
            for version,im in enumerate(images[i]):
                tile=Image.new('RGBA',(w,h),bg);tile.alpha_composite(im.crop(crop))
                x=(bg_index*2+version)*w;y=row*(h+24)
                board.paste(tile.convert('RGB'),(x,y+24))
                draw.text((x+4,y+5),f'Pose {i+1} / {"before" if version==0 else "refined"}',fill='white')
    board.save(out/'edge-comparison.png')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main(*sys.argv[1:])
