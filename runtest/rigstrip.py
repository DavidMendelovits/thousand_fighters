#!/usr/bin/env python3
"""Draw the run cycle's colour-coded rig guides as one strip and a looping GIF (no image model involved).
    python3 runtest/rigstrip.py runtest/faro.run.json runtest/faro-run-rig.png"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from PIL import Image
from paint import guide_image, CELL

data = json.load(open(sys.argv[1])); out = sys.argv[2]
frames = [guide_image(c, CELL) for c in data['cells']]
strip = Image.new('RGB', (CELL * len(frames), CELL))
for i, f in enumerate(frames): strip.paste(f, (i * CELL, 0))
strip.save(out)
frames[0].save(os.path.splitext(out)[0] + '.gif', save_all=True, append_images=frames[1:], duration=83, loop=0)
print('wrote', out)
