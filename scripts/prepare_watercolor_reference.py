"""Key and pad a reviewed watercolor body reference without flattening its palette."""
import argparse
from pathlib import Path
from PIL import Image
import numpy as np
from scipy import ndimage
from compile_animation_clip import key_background

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('image',type=Path);p.add_argument('output',type=Path)
a=p.parse_args()
if a.output.exists():raise ValueError('Use a new output path')
image=key_background(Image.open(a.image),'#ff00ff',mode='chroma')
alpha=np.array(image.getchannel('A'))
labels,_=ndimage.label(alpha>0)
sizes=np.bincount(labels.ravel());sizes[0]=0
alpha[labels!=sizes.argmax()]=0
image.putalpha(Image.fromarray(alpha))
box=image.getbbox()
if not box or min(box[0],box[1],image.width-box[2],image.height-box[3])<8:raise ValueError('Source is empty or clipped')
body=image.crop(box)
body=body.resize((round(body.width*232/body.height),232),Image.Resampling.LANCZOS)
canvas=Image.new('RGBA',(448,384))
canvas.alpha_composite(body,(192-body.width//2,352-body.height))
a.output.parent.mkdir(parents=True,exist_ok=True);canvas.save(a.output)
print(a.output)
