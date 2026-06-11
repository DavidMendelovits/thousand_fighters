#!/usr/bin/env python3
"""Extract and normalize frames from an AI-generated sprite sheet (1x6 row by default).

Detects character silhouettes against a magenta (#ff00ff) chroma background,
keys the background to transparency with edge despill, computes per-frame
anchors (the character's feet/pivot), optionally rescales the row to a target
silhouette height, and emits:

  - {moveId}_001.png ... {moveId}_006.png   normalized frames
  - sheet.png                                assembled row sheet (bottom-aligned)
  - extraction_report.json                   measurements, warnings, and a
                                             frameData fragment ready to merge
                                             into the fighter pack

Usage:
    python3 scripts/extract_row_frames.py <input.png> <output_dir> --move-id <moveId>
        [--rows 1 --cols 6] [--target-height N]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

FRAME_COUNT = 6
SIDE_PADDING = 4      # transparent px left/right/top of the silhouette
FLOOR_PADDING = 6     # transparent px below the feet (anchor sits on the feet)
FOOT_BAND_FRACTION = 0.12
DESPILL_CAP = 90      # edge pixels: r/b capped at g + DESPILL_CAP
RESCALE_TOLERANCE = 0.02  # skip rescale when within 2% of target


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract and normalize frames from a sprite row/grid sheet."
    )
    parser.add_argument("input", type=Path, help="Source row sheet PNG.")
    parser.add_argument("output_dir", type=Path, help="Output directory for frames.")
    parser.add_argument(
        "--move-id", required=True, help="Move id used as filename prefix."
    )
    parser.add_argument(
        "--rows", type=int, default=1,
        help="Grid rows in the source sheet (default 1). Use 2 with --cols 3 for the wide profile.",
    )
    parser.add_argument(
        "--cols", type=int, default=FRAME_COUNT,
        help="Grid columns in the source sheet (default 6).",
    )
    parser.add_argument(
        "--target-height", type=int, default=None,
        help="Rescale the row so the median silhouette height matches this value "
             "(keeps every move row at the same character scale).",
    )
    return parser.parse_args()


def is_magenta(pixel: tuple[int, ...]) -> bool:
    """Threshold-based magenta detection, tolerant of AI compression artifacts."""
    r, g, b = pixel[0], pixel[1], pixel[2]
    return r >= 200 and b >= 180 and g <= 80


def is_near_magenta(pixel: tuple[int, ...]) -> bool:
    """Looser magenta detection used for residue auditing."""
    r, g, b = pixel[0], pixel[1], pixel[2]
    return r >= 180 and b >= 160 and g <= 100


def non_magenta_bbox(
    image: Image.Image, x_start: int, x_end: int, y_start: int = 0, y_end: int | None = None
) -> tuple[int, int, int, int] | None:
    """Find the bounding box of non-magenta pixels in a grid cell region."""
    pixels = image.load()
    width, height = image.size
    y_end = height if y_end is None else min(y_end, height)
    min_x = width
    min_y = height
    max_x = 0
    max_y = 0
    found = False

    for y in range(y_start, y_end):
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


def chroma_key_with_despill(image: Image.Image) -> Image.Image:
    """Key magenta to transparency, then decontaminate the silhouette edge.

    Anti-aliased edge pixels are blends of character color and #ff00ff;
    binary keying keeps them opaque with a pink cast. Despill caps r/b at
    g + DESPILL_CAP, but only within 2px of transparency so legitimately
    pink/purple characters keep their interior colors.
    """
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size

    for y in range(height):
        for x in range(width):
            if is_magenta(pixels[x, y]):
                pixels[x, y] = (0, 0, 0, 0)

    # Edge band: opaque pixels within 2px (chebyshev) of a transparent pixel.
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
    return image.getchannel("A").getbbox()


def foot_anchor_x(image: Image.Image, bbox: tuple[int, int, int, int]) -> int:
    """Centroid-x of the bottom FOOT_BAND_FRACTION of the silhouette.

    Tracks the feet instead of the geometric center, so a frame whose limb
    extends far forward keeps the character planted instead of sliding.
    """
    left, top, right, bottom = bbox
    silhouette_height = bottom - top
    band_height = max(2, round(silhouette_height * FOOT_BAND_FRACTION))
    band_top = max(top, bottom - band_height)

    pixels = image.load()
    total_weight = 0
    weighted_x = 0
    for y in range(band_top, bottom):
        for x in range(left, right):
            a = pixels[x, y][3]
            if a:
                total_weight += a
                weighted_x += a * x
    if total_weight == 0:
        return (left + right) // 2
    return round(weighted_x / total_weight)


def normalize_frame(silhouette: Image.Image) -> tuple[Image.Image, dict[str, object]]:
    """Recanvas a keyed silhouette crop with standard padding and compute its anchor.

    Returns (frame, meta) where meta has anchor/reachX/silhouetteHeight relative
    to the emitted frame.
    """
    bbox = alpha_bbox(silhouette)
    if bbox is None:
        empty = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
        return empty, {"empty": True, "width": 1, "height": 1,
                       "anchor": {"x": 0, "y": 0}, "reachX": 0, "silhouetteHeight": 0}

    tight = silhouette.crop(bbox)
    anchor_x_in_tight = foot_anchor_x(silhouette, bbox) - bbox[0]

    width = tight.width + SIDE_PADDING * 2
    height = tight.height + SIDE_PADDING + FLOOR_PADDING
    frame = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    frame.alpha_composite(tight, (SIDE_PADDING, SIDE_PADDING))

    anchor_x = SIDE_PADDING + anchor_x_in_tight
    anchor_y = height - FLOOR_PADDING
    reach_x = (SIDE_PADDING + tight.width - 1) - anchor_x

    meta = {
        "empty": False,
        "width": width,
        "height": height,
        "anchor": {"x": anchor_x, "y": anchor_y},
        "reachX": reach_x,
        "silhouetteHeight": tight.height,
    }
    return frame, meta


def magenta_residue_ratio(frame: Image.Image) -> float:
    """Fraction of opaque pixels still reading as near-magenta after despill."""
    pixels = frame.load()
    opaque = 0
    residue = 0
    for y in range(frame.height):
        for x in range(frame.width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            opaque += 1
            if is_near_magenta((r, g, b)):
                residue += 1
    return (residue / opaque) if opaque else 0.0


def assemble_sheet(frames: list[Image.Image], metas: list[dict[str, object]], output_path: Path) -> None:
    """Assemble normalized frames into one bottom-aligned row sheet."""
    real = [(f, m) for f, m in zip(frames, metas) if not m["empty"]]
    if not real:
        Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(output_path)
        return
    cell_width = max(f.width for f, _ in real)
    cell_height = max(f.height for f, _ in real)
    sheet = Image.new("RGBA", (cell_width * len(frames), cell_height), (0, 0, 0, 0))
    for index, (frame, meta) in enumerate(zip(frames, metas)):
        if meta["empty"]:
            continue
        x = index * cell_width + (cell_width - frame.width) // 2
        y = cell_height - frame.height
        sheet.alpha_composite(frame, (x, y))
    sheet.save(output_path)


def extract_frames(
    source: Path,
    output_dir: Path,
    move_id: str,
    rows: int = 1,
    cols: int = FRAME_COUNT,
    target_height: int | None = None,
) -> dict[str, object]:
    """Extract, key, despill, anchor, and (optionally) rescale frames from a sheet."""
    output_dir.mkdir(parents=True, exist_ok=True)

    raw = Image.open(source).convert("RGBA")
    width, height = raw.size
    frame_count = rows * cols
    col_width = width / cols
    row_height = height / rows

    warnings: list[str] = []

    # Pass 1: crop each cell and key the background.
    silhouettes: list[Image.Image | None] = []
    edge_touches: list[bool] = []
    for i in range(frame_count):
        col_start = round((i % cols) * col_width)
        col_end = round(((i % cols) + 1) * col_width)
        row_start = round((i // cols) * row_height)
        row_end = round(((i // cols) + 1) * row_height)

        bbox = non_magenta_bbox(raw, col_start, col_end, row_start, row_end)
        if bbox is None:
            silhouettes.append(None)
            edge_touches.append(False)
            warnings.append(f"frame {i + 1}: empty cell — no character content detected")
            continue

        touches = (
            bbox[0] <= col_start or bbox[2] >= col_end
            or bbox[1] <= row_start or bbox[3] >= row_end
        )
        edge_touches.append(touches)
        if touches:
            warnings.append(
                f"frame {i + 1}: silhouette touches its cell boundary — a limb may be truncated"
            )

        crop = raw.crop(bbox)
        silhouettes.append(chroma_key_with_despill(crop))

    # Pass 2: optional uniform rescale so this row matches the fighter's scale.
    heights = [alpha_bbox(s)[3] - alpha_bbox(s)[1] for s in silhouettes if s is not None and alpha_bbox(s)]
    median_height = sorted(heights)[len(heights) // 2] if heights else 0
    scale_applied = 1.0
    if target_height and median_height:
        factor = target_height / median_height
        if abs(factor - 1.0) > RESCALE_TOLERANCE:
            scale_applied = factor
            silhouettes = [
                s.resize((max(1, round(s.width * factor)), max(1, round(s.height * factor))), Image.LANCZOS)
                if s is not None else None
                for s in silhouettes
            ]
            warnings.append(
                f"row rescaled by {factor:.3f} to match target silhouette height {target_height}px"
                f" (was {median_height}px)"
            )

    # Pass 3: normalize frames, compute anchors, audit residue.
    report: dict[str, object] = {
        "source": str(source),
        "moveId": move_id,
        "sourceSize": [width, height],
        "grid": [rows, cols],
        "frameCount": frame_count,
        "medianSilhouetteHeight": median_height,
        "scaleApplied": scale_applied,
        "warnings": warnings,
        "frames": [],
        "frameData": [],
    }

    frames: list[Image.Image] = []
    metas: list[dict[str, object]] = []
    for i, silhouette in enumerate(silhouettes):
        frame_num = i + 1
        filename = f"{move_id}_{frame_num:03d}.png"

        if silhouette is None:
            frame = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
            meta = {"empty": True, "width": 1, "height": 1,
                    "anchor": {"x": 0, "y": 0}, "reachX": 0, "silhouetteHeight": 0}
        else:
            frame, meta = normalize_frame(silhouette)
            residue = magenta_residue_ratio(frame)
            if residue > 0.005:
                warnings.append(
                    f"frame {frame_num}: {residue:.1%} of opaque pixels remain near-magenta after despill"
                )

        frame.save(output_dir / filename)
        frames.append(frame)
        metas.append(meta)

        report["frames"].append({
            "file": filename,
            "frameIndex": frame_num,
            "edgeTouch": edge_touches[i],
            **meta,
        })
        report["frameData"].append({
            "file": f"sprites/{move_id}/{filename}",
            "width": meta["width"],
            "height": meta["height"],
            "anchor": meta["anchor"],
            "reachX": meta["reachX"],
            "silhouetteHeight": meta["silhouetteHeight"],
        })

    assemble_sheet(frames, metas, output_dir / "sheet.png")

    report_path = output_dir / "extraction_report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    return report


def main() -> int:
    args = parse_args()

    if not args.input.exists():
        print(f"Error: source file not found: {args.input}", file=sys.stderr)
        return 1

    report = extract_frames(
        args.input,
        args.output_dir,
        args.move_id,
        rows=args.rows,
        cols=args.cols,
        target_height=args.target_height,
    )
    print(json.dumps({
        "output": str(args.output_dir),
        "moveId": report["moveId"],
        "medianSilhouetteHeight": report["medianSilhouetteHeight"],
        "scaleApplied": report["scaleApplied"],
        "warnings": report["warnings"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
