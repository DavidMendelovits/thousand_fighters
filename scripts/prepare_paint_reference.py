"""Preserve disconnected pigment and both summoned hands; use a fixed shared pivot."""
import argparse
from pathlib import Path
from PIL import Image
import numpy as np
p=argparse.ArgumentParser()
p.add_argument('source',type=Path);p.add_argument('output',type=Path)
p.add_argument('--height',type=int,default=220)
a=p.parse_args()
if a.output.exists():raise ValueError('Reference exists; choose a fresh version')
im=Image.open(a.source).convert('RGBA')
pixels=np.asarray(im).copy()
rgb=pixels[:,:,:3].astype(float)
corners=np.concatenate([rgb[:8,:8].reshape(-1,3),rgb[:8,-8:].reshape(-1,3),rgb[-8:,:8].reshape(-1,3),rgb[-8:,-8:].reshape(-1,3)])
key=np.median(corners,axis=0)
pixels[np.linalg.norm(rgb-key,axis=2)<65,3]=0
im=Image.fromarray(pixels)
box=im.getbbox()
if not box:raise ValueError('Empty reference')
im=im.crop(box);im=im.resize((round(im.width*a.height/im.height),a.height),Image.Resampling.LANCZOS)
canvas=Image.new('RGBA',(672,480));canvas.alpha_composite(im,(288-im.width//2,440-im.height))
a.output.parent.mkdir(parents=True,exist_ok=True);canvas.save(a.output)
