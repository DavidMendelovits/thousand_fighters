#!/usr/bin/env python3
"""Downsample oversized runtime sprites to their authored display size.

Source and CMS assets stay untouched. The fight-only deployment gets smaller
decoded textures and compensating sprite scales, preserving on-canvas size.
"""

import json
import pathlib
import sys
from PIL import Image


root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "dist-fight")
fighter = root / "fighters" / "palimpsest"
config_path = fighter / "config.json"
if not config_path.exists():
    raise SystemExit("Palimpsest config is missing from the fight build")

config = json.loads(config_path.read_text())
ratio = 0.5
seen: set[str] = set()


def optimize_sprite(sprite: dict) -> None:
    sprite["scale"] = float(sprite.get("scale", 1)) / ratio
    for frames in sprite.get("frames", {}).values():
        for frame in frames:
            relative = frame["file"]
            frame["width"] = max(1, round(frame["width"] * ratio))
            frame["height"] = max(1, round(frame["height"] * ratio))
            frame["anchor"]["x"] = round(frame["anchor"]["x"] * ratio)
            frame["anchor"]["y"] = round(frame["anchor"]["y"] * ratio)
            if relative in seen:
                continue
            seen.add(relative)
            path = fighter / relative
            with Image.open(path) as image:
                size = (max(1, round(image.width * ratio)), max(1, round(image.height * ratio)))
                image.resize(size, Image.Resampling.NEAREST).save(path, optimize=True)


if config.get("sprite"):
    optimize_sprite(config["sprite"])
for actor in config.get("actors", []):
    if actor.get("sprite"):
        optimize_sprite(actor["sprite"])

config_path.write_text(json.dumps(config, indent=2) + "\n")
print(json.dumps({"fighter": "palimpsest", "optimizedFrames": len(seen), "ratio": ratio}))
