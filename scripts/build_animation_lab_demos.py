#!/usr/bin/env python3
"""Deterministic geometry fixtures for the Animation Lab, explicitly not AI art.

These exercise difficult export invariants with known ground truth. Generated
video candidates are added separately and never represented as passing art QA.
"""
import argparse
import json
import math
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

from compile_animation_clip import compile_clip

ROOT = Path(__file__).resolve().parents[1]
SIZE = (160, 144)


def rig(draw, pivot, angle=0, color="#4de5ca", stretch=1):
    """A deliberately simple pixel-jointed training mannequin."""
    def p(x, y):
        y *= stretch
        return (round(pivot[0] + x * math.cos(angle) - y * math.sin(angle)),
                round(pivot[1] + x * math.sin(angle) + y * math.cos(angle)))
    def bone(a, b, width=7):
        draw.line([p(*a), p(*b)], fill="#122739", width=width + 4)
        draw.line([p(*a), p(*b)], fill=color, width=width)
    bone((-6, 4), (-12, 20))
    bone((6, 4), (16, 17))
    bone((-9, -17), (-20, -5), 6)
    bone((9, -17), (22, -27), 6)
    draw.polygon([p(-10, -22), p(10, -22), p(9, 6), p(-9, 6)], fill=color, outline="#122739", width=3)
    draw.polygon([p(-8, -39), p(7, -39), p(11, -34), p(10, -25), p(-8, -25)], fill=color, outline="#122739", width=2)
    draw.line([p(-4, -32), p(7, -32)], fill="#effff1", width=3)
    draw.line([p(1, -31), p(7, -31)], fill="#122739", width=2)
    draw.polygon([p(0, -17), p(5, -12), p(0, -7), p(-5, -12)], fill="#effff1")


def save_sequence(directory, name, images):
    folder = directory / name
    folder.mkdir()
    paths = []
    for i, image in enumerate(images):
        path = folder / f"{i:03d}.png"
        image.save(path)
        paths.append(str(path))
    return paths


def make_demo(clip_id, temporary):
    count = 24
    frames, back, front, roots = [], [], [], []
    for i in range(count):
        t = i / (count - 1)
        body = Image.new("RGBA", SIZE)
        aura = Image.new("RGBA", SIZE)
        effect = Image.new("RGBA", SIZE)
        d, a, e = ImageDraw.Draw(body), ImageDraw.Draw(aura), ImageDraw.Draw(effect)
        if clip_id == "acrobatics":
            x, y = 46 + 64 * t, 104 - 46 * math.sin(math.pi * t)
            angle = math.tau * min(1, max(0, (t - 0.12) / 0.76))
            rig(d, (x, y), angle)
            roots.append({"x": x, "y": y})
        elif clip_id == "morph":
            # Deliberate disconnected droplets → large new silhouette.
            if t < 0.25:
                rig(d, (80, 108), color="#ffa65e", stretch=1 - t * 2)
            elif t < 0.58:
                phase = (t - 0.25) / 0.33
                for j in range(5):
                    x = 80 + (j - 2) * 15 * math.sin(math.pi * phase)
                    y = 111 - (24 if j % 2 else 12) * math.sin(math.pi * phase)
                    r = 4 + (3 if j == 2 else 0)
                    d.ellipse((round(x-r), round(y-r), round(x+r), round(y+r)), fill="#ffb565", outline="#492b38", width=2)
            else:
                growth = (t - 0.58) / 0.42
                h = 18 + 76 * growth
                w = 12 + 17 * growth
                points = [(80-w, 113), (80-w-8, 100-h*.25), (80-w+5, 108-h*.7),
                          (72, 113-h), (86, 108-h), (80+w-4, 108-h*.65),
                          (80+w+9, 109-h*.2), (80+w, 113)]
                d.polygon([(round(x),round(y)) for x,y in points], fill="#ffb565", outline="#492b38", width=3)
                for side in (-1, 1):
                    arm = [(80+side*w, 112-h*.63), (80+side*(w+20), 105-h*.38), (80+side*(w+27), 90-h*.2)]
                    d.line([(round(x),round(y)) for x,y in arm], fill="#492b38", width=10)
                    d.line([(round(x),round(y)) for x,y in arm], fill="#f5834f", width=6)
                d.rectangle((74, round(119-h), 88, round(122-h)), fill="#fff4cb")
            roots.append({"x":80,"y":113})
        else:
            rig(d, (60, 103), color="#b09aff")
            roots.append({"x":60,"y":103})
            radius = 25 + round(8 * math.sin(math.pi * t)**2)
            for j in range(3):
                r = radius + j*5
                a.ellipse((60-r,80-r,60+r,80+r), outline=(155,111,255,110-j*20), width=2)
            for j in range(8):
                angle = math.tau*j/8 + t*math.tau
                x,y = 60+math.cos(angle)*(radius+11), 80+math.sin(angle)*(radius+11)
                a.rectangle((round(x),round(y),round(x)+2,round(y)+2), fill=(211,181,255,160))
            if 7 <= i <= 19:
                progress = (i-7)/12
                x = 85 + 56*progress
                r = 4 + round(6*math.sin(math.pi*progress))
                for trail in range(4,0,-1):
                    tx=x-trail*5
                    e.rectangle((round(tx-r/2),71-trail//2,round(tx+r/2),77+trail//2), fill=(103,236,255, max(30,170-trail*30)))
                e.ellipse((round(x-r),74-r,round(x+r),74+r), fill="#60eaff", outline="#b29bff", width=2)
                e.rectangle((round(x)-2,72,round(x)+2,76), fill="#f4ffff")
        frames.append(body)
        back.append(aura)
        front.append(effect)
    anchor = {"x":46,"y":104} if clip_id == "acrobatics" else roots[0]
    source = {"frames": save_sequence(temporary,"body",frames), "fps":20,"anchor":anchor,"rootTrack":roots}
    names = {"acrobatics":"Orbit vault", "morph":"Sludge awakening", "energy_cast":"Ion bloom"}
    spec = {"id":clip_id,"displayName":names[clip_id],"kind": {"acrobatics":"acrobatics","morph":"transformation","energy_cast":"projectile-cast"}[clip_id],
            "playback":"once" if clip_id=="morph" else "loop", "tickRate":60,"scale":1,"padding":5,
            "rootMode":"extract" if clip_id=="acrobatics" else "in-place",
            "intent":{"topologyChanges":clip_id=="morph","scaleChanges":clip_id=="morph","paletteChanges":False},
            "selection":[{"frame":i,"durationTicks":3 if i not in (0,23) else 8} for i in range(count)],
            "layers":[{"id":"body","role":"body","z":0,"source":source}],
            "events":[{"tick":8,"type":"launch" if clip_id=="acrobatics" else "transform-start" if clip_id=="morph" else "charge","label":"Launch" if clip_id=="acrobatics" else "Dissolve" if clip_id=="morph" else "Charge"},
                      {"tick":38,"type":"apex" if clip_id=="acrobatics" else "reform" if clip_id=="morph" else "spawn","label":"Inversion" if clip_id=="acrobatics" else "Reform" if clip_id=="morph" else "Release"},
                      {"tick":74,"type":"land" if clip_id=="acrobatics" else "transform-end" if clip_id=="morph" else "recover","label":"Land" if clip_id=="acrobatics" else "New form" if clip_id=="morph" else "Recover"}],
            "provenance":{"method":"procedural-fixture","description":"Deterministic geometry fixture with known pivots and timing. Tests the compiler; not AI-generated or production character art."}}
    if clip_id=="energy_cast":
        for layer_id,role,z,images in [("aura","aura",-1,back),("projectile","projectile",1,front)]:
            spec["layers"].append({"id":layer_id,"role":role,"z":z,"blend":"normal",
                                   "source":{"frames":save_sequence(temporary,layer_id,images),"fps":20,"anchor":anchor,"rootTrack":roots}})
    return spec


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,default=ROOT/"public/animation-lab")
    args=parser.parse_args()
    entries=[]
    for clip_id,tags,description in [
        ("acrobatics",["24 frames","root motion","fixture"],"An inverted vault with an authored trajectory. Toggle root motion to inspect alignment."),
        ("morph",["24 frames","topology change","fixture"],"Five separated droplets reform into an oversized creature. Growth survives normalization."),
        ("energy_cast",["3 layers","projectile + aura","fixture"],"Independently switch the body, orbiting aura and travelling projectile on or off."),
    ]:
        with tempfile.TemporaryDirectory(prefix="tf-demo-") as name:
            spec=make_demo(clip_id,Path(name))
            output=args.output/clip_id
            if output.exists():
                raise SystemExit(f"Demo exists: {output}; choose --output for a new version")
            clip=compile_clip(spec,Path(name),output.resolve())
            entries.append({"id":clip_id,"name":clip["displayName"],"description":description,
                            "url":f"/animation-lab/{clip_id}/clip.json","tags":tags})
    (args.output/"index.json").write_text(json.dumps({"clips":entries},indent=2)+"\n")
    print(f"Built {len(entries)} fixture clips in {args.output}")


if __name__=="__main__":
    main()
