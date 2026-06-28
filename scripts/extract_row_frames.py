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

Frames are segmented by connected components, not by hard grid cuts: every
blob of character pixels is assigned wholly to the grid cell that contains
most of it. A limb that bleeds across a cell boundary stays with its owner
frame instead of being truncated there and leaking into the neighbor.

Usage:
    python3 scripts/extract_row_frames.py <input.png> <output_dir> --move-id <moveId>
        [--rows 1 --cols 6] [--target-height N]
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import deque
from pathlib import Path

from PIL import Image

FRAME_COUNT = 6
SIDE_PADDING = 4      # transparent px left/right/top of the silhouette
FLOOR_PADDING = 6     # transparent px below the feet (anchor sits on the feet)
FOOT_BAND_FRACTION = 0.12
DESPILL_CAP = 90      # edge pixels: r/b capped at g + DESPILL_CAP
RESCALE_TOLERANCE = 0.02  # skip rescale when within 2% of target
MIN_COMPONENT_PX = 8  # blobs smaller than this are compression noise, dropped
# A component whose second-best cell holds more than this share of its pixels
# is probably two sprites fused together — split it at the cell boundary.
FUSED_SECOND_CELL_SHARE = 0.30


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
    parser.add_argument(
        "--body-half-width", type=int, default=None,
        help="The fighter's idle body half-width in pixels (median base-row reachX). "
             "When set, each frame also gets an attackBox: the bbox of pixels "
             "protruding beyond this envelope in the facing (+x) direction.",
    )
    equalize_group = parser.add_mutually_exclusive_group()
    equalize_group.add_argument(
        "--equalize-frames", dest="equalize_frames", action="store_true", default=True,
        help="(default) Rescale each frame's silhouette individually so every frame "
             "in the row has the same silhouette height, eliminating frame-to-frame "
             "jitter. Scale target = --target-height if supplied, else the row's own "
             "median silhouette height.",
    )
    equalize_group.add_argument(
        "--no-equalize-frames", dest="equalize_frames", action="store_false",
        help="Skip per-frame equalization. Use for height-dynamic rows (jump/crouch) "
             "where the character legitimately changes height across frames.",
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


def label_components(
    fg: list[bool], width: int, height: int
) -> list[list[int]]:
    """8-connected component labeling over the foreground mask.

    Returns a list of components, each a list of flat pixel indices.
    """
    labels = [-1] * (width * height)
    components: list[list[int]] = []

    for start in range(width * height):
        if not fg[start] or labels[start] != -1:
            continue
        label = len(components)
        pixels: list[int] = []
        queue = deque((start,))
        labels[start] = label
        while queue:
            idx = queue.popleft()
            pixels.append(idx)
            x = idx % width
            y = idx // width
            for dy in (-1, 0, 1):
                ny = y + dy
                if ny < 0 or ny >= height:
                    continue
                row_base = ny * width
                for dx in (-1, 0, 1):
                    nx = x + dx
                    if nx < 0 or nx >= width:
                        continue
                    nidx = row_base + nx
                    if fg[nidx] and labels[nidx] == -1:
                        labels[nidx] = label
                        queue.append(nidx)
        components.append(pixels)

    return components


def assign_components_to_cells(
    components: list[list[int]],
    width: int,
    rows: int,
    cols: int,
    col_width: float,
    row_height: float,
    warnings: list[str],
) -> list[list[int]]:
    """Assign each component's pixels to the grid cell holding most of them.

    Returns per-cell pixel-index lists. Components that straddle a boundary go
    wholly to their majority cell (this is the overlap fix: a limb bleeding
    into the neighbor cell stays with its owner). A component with no clear
    majority is likely two fused sprites and is split at the cell boundary
    instead.
    """
    frame_count = rows * cols
    cell_pixels: list[list[int]] = [[] for _ in range(frame_count)]

    def cell_of(idx: int) -> int:
        x = idx % width
        y = idx // width
        col = min(cols - 1, int(x / col_width))
        row = min(rows - 1, int(y / row_height))
        return row * cols + col

    for pixels in components:
        if len(pixels) < MIN_COMPONENT_PX:
            continue  # compression noise / stray specks

        counts: dict[int, int] = {}
        for idx in pixels:
            cell = cell_of(idx)
            counts[cell] = counts.get(cell, 0) + 1

        ranked = sorted(counts.items(), key=lambda item: item[1], reverse=True)
        owner, owner_count = ranked[0]

        if len(ranked) > 1:
            second_share = ranked[1][1] / len(pixels)
            if second_share > FUSED_SECOND_CELL_SHARE:
                warnings.append(
                    f"frames {owner + 1} and {ranked[1][0] + 1}: silhouettes appear fused "
                    f"across the cell boundary — split at the grid line; regenerate this "
                    f"sheet with clearer gutters for a clean result"
                )
                for idx in pixels:
                    cell_pixels[cell_of(idx)].append(idx)
                continue
            if owner_count < len(pixels):
                spill = 1.0 - owner_count / len(pixels)
                if spill > 0.02:
                    warnings.append(
                        f"frame {owner + 1}: content bleeds {spill:.0%} past its cell "
                        f"boundary — kept with this frame"
                    )

        cell_pixels[owner].extend(pixels)

    return cell_pixels


def silhouette_from_pixels(
    raw: Image.Image, pixels: list[int]
) -> tuple[Image.Image, tuple[int, int, int, int]]:
    """Build a keyed RGBA silhouette from a frame's assigned pixels.

    Only the assigned pixels are opaque — anything else inside the bounding
    box (including another frame's leaked pixels) stays transparent.
    """
    width = raw.width
    min_x = min(idx % width for idx in pixels)
    max_x = max(idx % width for idx in pixels)
    min_y = min(idx // width for idx in pixels)
    max_y = max(idx // width for idx in pixels)
    bbox = (min_x, min_y, max_x + 1, max_y + 1)

    src = raw.load()
    out = Image.new("RGBA", (max_x - min_x + 1, max_y - min_y + 1), (0, 0, 0, 0))
    dst = out.load()
    for idx in pixels:
        x = idx % width
        y = idx // width
        r, g, b = src[x, y][:3]
        dst[x - min_x, y - min_y] = (r, g, b, 255)
    return out, bbox


def despill_edges(rgba: Image.Image) -> Image.Image:
    """Decontaminate magenta spill on the silhouette edge.

    Anti-aliased edge pixels are blends of character color and #ff00ff.
    Despill caps r/b at g + DESPILL_CAP, but only within 2px of transparency
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


HURTBOX_TRIM_FRACTION = 0.01  # opaque-pixel mass trimmed per side (left/right/top)


def derive_frame_boxes(
    frame: Image.Image, anchor: dict[str, int], body_half_width: int | None
) -> tuple[dict[str, int] | None, dict[str, int] | None]:
    """Derive anchor-relative collision boxes from a normalized frame's pixels.

    hurtbox: the silhouette bbox with HURTBOX_TRIM_FRACTION of opaque pixel
    mass trimmed from left/right/top, so a wisp of hair or a particle doesn't
    inflate the vulnerable area. The bottom stays exact (feet on the anchor).

    attackBox: bbox of pixels extending beyond the idle body envelope in the
    facing (+x) direction — the limb/weapon doing the hitting. Only computed
    when body_half_width is provided (attack rows).

    Both are in frame-pixel space relative to the anchor; the runtime
    converter multiplies by the render scale.
    """
    pixels = frame.load()
    width, height = frame.size

    col_mass = [0] * width
    row_mass = [0] * height
    total = 0
    for y in range(height):
        for x in range(width):
            if pixels[x, y][3]:
                col_mass[x] += 1
                row_mass[y] += 1
                total += 1
    if total == 0:
        return None, None

    def trimmed_low(mass: list[int]) -> int:
        budget = total * HURTBOX_TRIM_FRACTION
        acc = 0
        for index, value in enumerate(mass):
            acc += value
            if acc > budget:
                return index
        return 0

    def trimmed_high(mass: list[int]) -> int:
        budget = total * HURTBOX_TRIM_FRACTION
        acc = 0
        for index in range(len(mass) - 1, -1, -1):
            acc += mass[index]
            if acc > budget:
                return index
        return len(mass) - 1

    left = trimmed_low(col_mass)
    right = trimmed_high(col_mass)
    top = trimmed_low(row_mass)
    bottom = max(y for y in range(height) if row_mass[y])

    anchor_x = anchor["x"]
    anchor_y = anchor["y"]
    hurtbox = {
        "x": left - anchor_x,
        "y": top - anchor_y,
        "width": right - left + 1,
        "height": bottom - top + 1,
    }

    attack_box = None
    if body_half_width is not None:
        threshold = anchor_x + body_half_width
        min_x = width
        min_y = height
        max_x = -1
        max_y = -1
        for y in range(height):
            for x in range(max(0, threshold + 1), width):
                if pixels[x, y][3]:
                    min_x = min(min_x, x)
                    max_x = max(max_x, x)
                    min_y = min(min_y, y)
                    max_y = max(max_y, y)
        if max_x >= 0:
            attack_box = {
                "x": min_x - anchor_x,
                "y": min_y - anchor_y,
                "width": max_x - min_x + 1,
                "height": max_y - min_y + 1,
            }

    return hurtbox, attack_box


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
    body_half_width: int | None = None,
    equalize_frames: bool = True,
) -> dict[str, object]:
    """Extract, key, despill, anchor, and (optionally) rescale frames from a sheet."""
    output_dir.mkdir(parents=True, exist_ok=True)

    raw = Image.open(source).convert("RGBA")
    width, height = raw.size
    frame_count = rows * cols
    col_width = width / cols
    row_height = height / rows

    warnings: list[str] = []

    # Pass 1: segment the sheet into connected character blobs and assign each
    # blob wholly to its majority grid cell — no hard cuts at cell boundaries.
    data = raw.getdata()
    fg = [not is_magenta(pixel) for pixel in data]
    components = label_components(fg, width, height)
    cell_pixels = assign_components_to_cells(
        components, width, rows, cols, col_width, row_height, warnings
    )

    silhouettes: list[Image.Image | None] = []
    edge_touches: list[bool] = []
    for i in range(frame_count):
        pixels = cell_pixels[i]
        if not pixels:
            silhouettes.append(None)
            edge_touches.append(False)
            warnings.append(f"frame {i + 1}: empty cell — no character content detected")
            continue

        keyed, bbox = silhouette_from_pixels(raw, pixels)
        # Touching the sheet's outer border means the canvas truncated content.
        touches = (
            bbox[0] <= 0 or bbox[2] >= width
            or bbox[1] <= 0 or bbox[3] >= height
        )
        edge_touches.append(touches)
        if touches:
            warnings.append(
                f"frame {i + 1}: silhouette touches the sheet border — content may be truncated"
            )
        silhouettes.append(despill_edges(keyed))

    # Pass 2: equalize every frame's silhouette to a common height so the
    # character doesn't grow/shrink frame-to-frame ("jitter").
    #
    # equalize_frames=True (default): scale EACH frame individually about its
    # bottom (foot) edge to row_target px, then bottom-align. This makes every
    # frame's silhouetteHeight identical, which is what the engine needs.
    #
    # equalize_frames=False: keep current per-row median approach (for dynamic
    # rows like jump/crouch where height legitimately changes).
    heights = [alpha_bbox(s)[3] - alpha_bbox(s)[1] for s in silhouettes if s is not None and alpha_bbox(s)]
    median_height = sorted(heights)[len(heights) // 2] if heights else 0
    scale_applied = 1.0
    if equalize_frames and median_height:
        # Target = explicit override if given, else the row's own median.
        row_target = target_height if target_height else median_height
        new_silhouettes = []
        any_changed = False
        for s in silhouettes:
            if s is None:
                new_silhouettes.append(None)
                continue
            bbox = alpha_bbox(s)
            if not bbox:
                new_silhouettes.append(s)
                continue
            sil_h = bbox[3] - bbox[1]
            if sil_h == row_target:
                new_silhouettes.append(s)
                continue
            # Scale so silhouette height == row_target exactly (no tolerance).
            factor = row_target / sil_h
            new_w = max(1, round(s.width * factor))
            new_h = max(1, round(s.height * factor))
            new_silhouettes.append(s.resize((new_w, new_h), Image.LANCZOS))
            any_changed = True
        silhouettes = new_silhouettes
        if any_changed:
            scale_applied = row_target / median_height if median_height else 1.0
            warnings.append(
                f"frames equalized to silhouette height {row_target}px per frame"
                + (f" (base median was {median_height}px)" if target_height and target_height != median_height else f" (row median was {median_height}px)")
            )
    elif not equalize_frames and target_height and median_height:
        # Legacy path: uniform row rescale without per-frame equalization.
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
        "segmentation": "connected-components",
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
            hurtbox = None
            attack_box = None
        else:
            frame, meta = normalize_frame(silhouette)
            residue = magenta_residue_ratio(frame)
            if residue > 0.005:
                warnings.append(
                    f"frame {frame_num}: {residue:.1%} of opaque pixels remain near-magenta after despill"
                )
            hurtbox, attack_box = derive_frame_boxes(
                frame, meta["anchor"],
                body_half_width if move_id != "base" else None,
            )

        frame.save(output_dir / filename)
        frames.append(frame)
        metas.append(meta)

        report["frames"].append({
            "file": filename,
            "frameIndex": frame_num,
            "edgeTouch": edge_touches[i],
            "hurtbox": hurtbox,
            "attackBox": attack_box,
            **meta,
        })
        report["frameData"].append({
            "file": f"sprites/{move_id}/{filename}",
            "width": meta["width"],
            "height": meta["height"],
            "anchor": meta["anchor"],
            "reachX": meta["reachX"],
            "silhouetteHeight": meta["silhouetteHeight"],
            "hurtbox": hurtbox,
            "attackBox": attack_box,
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
        body_half_width=args.body_half_width,
        equalize_frames=args.equalize_frames,
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
