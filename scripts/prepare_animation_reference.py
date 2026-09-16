#!/usr/bin/env python3
"""Pad an approved sprite for a video model without changing its design.

Uses integer nearest-neighbor enlargement only, leaving a motion-safe margin.
"""
import argparse
from pathlib import Path
from PIL import Image


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("image",type=Path)
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--size",type=int,default=512)
    p.add_argument("--background",default="#ff00ff")
    p.add_argument("--occupancy",type=float,default=.65,help="Maximum body fraction of canvas; .4 reserves space for long attacks")
    args=p.parse_args()
    if args.size<300 or args.size>2048:
        p.error("size must be 300–2048")
    if not .2 <= args.occupancy <= .8:
        p.error("occupancy must be between 0.2 and 0.8")
    if args.output.exists():
        p.error("output exists; use a new filename")
    with Image.open(args.image) as image:
        sprite=image.convert("RGBA")
    bbox=sprite.getchannel("A").getbbox()
    if not bbox:
        p.error("reference is empty")
    sprite=sprite.crop(bbox)
    available=round(args.size*args.occupancy)
    if max(sprite.size)>available:
        p.error("sprite exceeds motion-safe canvas; choose a larger --size instead of shrinking the art")
    scale=max(1,available//max(sprite.size))
    sprite=sprite.resize((sprite.width*scale,sprite.height*scale),Image.Resampling.NEAREST)
    canvas=Image.new("RGBA",(args.size,args.size),args.background)
    x=(args.size-sprite.width)//2
    y=round(args.size*.82)-sprite.height
    canvas.alpha_composite(sprite,(x,y))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    canvas.convert("RGB").save(args.output)
    print(f"Prepared {args.output}: {args.size}×{args.size}, integer art scale {scale}×, feet near y={y+sprite.height}")


if __name__=="__main__": main()
