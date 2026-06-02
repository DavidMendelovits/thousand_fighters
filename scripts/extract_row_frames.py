#!/usr/bin/env python3
"""Extract individual frames from a 1x6 AI-generated sprite row sheet.

Detects character bounding boxes against a magenta (#ff00ff) chroma
background, crops each frame with padding, keys magenta to transparency,
and saves 6 individual PNGs plus an extraction_report.json.

Usage:
    python3 scripts/extract_row_frames.py <input.png> <output_dir> --move-id <moveId>
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

FRAME_COUNT = 6
CROP_PADDING = 4


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract individual frames from a 1x6 sprite row sheet."
    )
    parser.add_argument("input", type=Path, help="Source row sheet PNG.")
    parser.add_argument("output_dir", type=Path, help="Output directory for frames.")
    parser.add_argument(
        "--move-id", required=True, help="Move id used as filename prefix."
    )
    return parser.parse_args()


def is_magenta(pixel: tuple[int, ...]) -> bool:
    """Threshold-based magenta detection, tolerant of AI compression artifacts.

    Matches the approach used by normalize_fighter_sheet_contours.py:
    high red, high blue, low green.
    """
    r, g, b = pixel[0], pixel[1], pixel[2]
    return r >= 200 and b >= 180 and g <= 80


def chroma_key_magenta(image: Image.Image) -> Image.Image:
    """Replace magenta-ish background pixels with full transparency."""
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    for y in range(height):
        for x in range(width):
            if is_magenta(pixels[x, y]):
                pixels[x, y] = (0, 0, 0, 0)
    return rgba


def non_magenta_bbox(
    image: Image.Image, x_start: int, x_end: int
) -> tuple[int, int, int, int] | None:
    """Find the bounding box of non-magenta pixels in a vertical column region.

    Returns (left, top, right, bottom) or None if no content found.
    """
    pixels = image.load()
    width, height = image.size
    min_x = width
    min_y = height
    max_x = 0
    max_y = 0
    found = False

    for y in range(height):
        for x in range(x_start, min(x_end, width)):
            if not is_magenta(pixels[x, y]):
                found = True
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)

    if not found:
        return None

    return (min_x, min_y, max_x + 1, max_y + 1)


def extract_frames(
    source: Path, output_dir: Path, move_id: str
) -> dict[str, object]:
    """Extract 6 frames from a 1x6 row sheet and save as individual PNGs."""
    output_dir.mkdir(parents=True, exist_ok=True)

    raw = Image.open(source).convert("RGBA")
    width, height = raw.size
    col_width = width / FRAME_COUNT

    report: dict[str, object] = {
        "source": str(source),
        "moveId": move_id,
        "sourceSize": [width, height],
        "frameCount": FRAME_COUNT,
        "frames": [],
    }

    for i in range(FRAME_COUNT):
        frame_num = i + 1
        filename = f"{move_id}_{frame_num:03d}.png"
        col_start = round(i * col_width)
        col_end = round((i + 1) * col_width)

        bbox = non_magenta_bbox(raw, col_start, col_end)

        if bbox is None:
            # Empty column -- output a transparent 1x1 PNG
            empty = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
            empty.save(output_dir / filename)
            report["frames"].append(
                {
                    "file": filename,
                    "frameIndex": frame_num,
                    "empty": True,
                    "width": 1,
                    "height": 1,
                    "bbox": None,
                }
            )
            continue

        # Expand bbox with padding, clamped to image bounds
        left = max(0, bbox[0] - CROP_PADDING)
        top = max(0, bbox[1] - CROP_PADDING)
        right = min(width, bbox[2] + CROP_PADDING)
        bottom = min(height, bbox[3] + CROP_PADDING)

        crop = raw.crop((left, top, right, bottom))
        # Key out magenta background to transparency
        frame = chroma_key_magenta(crop)
        frame.save(output_dir / filename)

        report["frames"].append(
            {
                "file": filename,
                "frameIndex": frame_num,
                "empty": False,
                "width": frame.width,
                "height": frame.height,
                "bbox": [left, top, right, bottom],
            }
        )

    # Write extraction report
    report_path = output_dir / "extraction_report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    return report


def main() -> int:
    args = parse_args()

    if not args.input.exists():
        print(f"Error: source file not found: {args.input}", file=sys.stderr)
        return 1

    report = extract_frames(args.input, args.output_dir, args.move_id)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
