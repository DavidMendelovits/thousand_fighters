#!/usr/bin/env python3
"""Normalize a raw AI-generated projectile sprite.

Takes one input PNG → chroma-keys #ff00ff magenta to transparent, despills
edge contamination, crops to the alpha bounding box, and downscales so the
longest side is ≤ 256px (preserving aspect ratio). Writes the normalized PNG
to the specified output path.

Usage:
    python3 scripts/normalize_projectile.py <input.png> <output.png>
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

MAX_LONG_SIDE = 256   # longest side target (px)
DESPILL_CAP = 90      # same constant used in extract_row_frames.py


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Normalize a raw AI-generated projectile PNG: chroma-key, despill, crop, downscale."
    )
    parser.add_argument("input", type=Path, help="Raw input PNG (RGB or RGBA).")
    parser.add_argument("output", type=Path, help="Normalized output PNG (RGBA, transparent background).")
    parser.add_argument(
        "--max-size", type=int, default=MAX_LONG_SIDE,
        help=f"Maximum long side in pixels after crop (default {MAX_LONG_SIDE}).",
    )
    return parser.parse_args()


def is_magenta(pixel: tuple[int, ...]) -> bool:
    """Threshold-based magenta detection, tolerant of AI JPEG/compression artifacts."""
    r, g, b = pixel[0], pixel[1], pixel[2]
    return r >= 200 and b >= 180 and g <= 80


def chroma_key(image: Image.Image) -> Image.Image:
    """Convert solid magenta pixels to transparent.

    Works on RGB input by first converting to RGBA, then zeroing the alpha
    channel for every pixel that reads as magenta.
    """
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    for y in range(height):
        for x in range(width):
            r, g, b, _a = pixels[x, y]
            if is_magenta((r, g, b)):
                pixels[x, y] = (r, g, b, 0)
    return rgba


def despill_edges(rgba: Image.Image) -> Image.Image:
    """Decontaminate magenta spill on the silhouette edge.

    Anti-aliased edge pixels are blends of character color and #ff00ff.
    Caps r/b channels at g + DESPILL_CAP, but only within 2px of transparency
    so legitimately pink/purple characters keep their interior colors.
    """
    pixels = rgba.load()
    width, height = rgba.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a == 0 or (min(r, b) - g) <= DESPILL_CAP:
                continue
            near_edge = False
            for dy in (-2, -1, 0, 1, 2):
                for dx in (-2, -1, 0, 1, 2):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < width and 0 <= ny < height and pixels[nx, ny][3] == 0:
                        near_edge = True
                        break
                if near_edge:
                    break
            if near_edge:
                cap = g + DESPILL_CAP
                pixels[x, y] = (min(r, cap), g, min(b, cap), a)
    return rgba


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    """Return the bounding box of non-transparent pixels, or None if fully transparent."""
    return image.getchannel("A").getbbox()


def crop_to_content(image: Image.Image) -> Image.Image:
    """Crop the image to the tight bounding box of opaque pixels."""
    bbox = alpha_bbox(image)
    if bbox is None:
        return image  # nothing opaque — return as-is
    return image.crop(bbox)


def downscale_to_fit(image: Image.Image, max_long_side: int) -> Image.Image:
    """Downscale so the longest side is ≤ max_long_side, preserving aspect ratio.

    Upscales are never applied (a small projectile stays small).
    """
    w, h = image.size
    long_side = max(w, h)
    if long_side <= max_long_side:
        return image  # already within bounds
    factor = max_long_side / long_side
    new_w = max(1, round(w * factor))
    new_h = max(1, round(h * factor))
    return image.resize((new_w, new_h), Image.LANCZOS)


def normalize_projectile(input_path: Path, output_path: Path, max_size: int = MAX_LONG_SIDE) -> dict[str, object]:
    """Full normalization pipeline: chroma-key → despill → crop → downscale.

    Returns a dict with input/output dims and alpha presence for verification.
    """
    raw = Image.open(input_path)
    input_size = raw.size

    keyed = chroma_key(raw)
    despilled = despill_edges(keyed)
    cropped = crop_to_content(despilled)
    final = downscale_to_fit(cropped, max_size)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    final.save(output_path, format="PNG")

    bbox = alpha_bbox(final)
    has_alpha = bbox is not None  # at least some opaque pixels

    return {
        "inputSize": list(input_size),
        "outputSize": list(final.size),
        "hasAlpha": has_alpha,
        "inputPath": str(input_path),
        "outputPath": str(output_path),
    }


def main() -> int:
    args = parse_args()

    if not args.input.exists():
        print(f"Error: input file not found: {args.input}", file=sys.stderr)
        return 1

    import json
    result = normalize_projectile(args.input, args.output, max_size=args.max_size)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
