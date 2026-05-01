#!/usr/bin/env python3
"""Normalize AI fighter sheets into per-frame PNGs using connected contours.

This is intentionally stricter than equal-grid cropping. AI-generated sprite
sheets often place fragments from neighboring poses inside a nominal cell. The
runtime frame should keep the dominant character contour only; independent
projectiles/VFX are exported separately.
"""

from __future__ import annotations

import argparse
import json
import shutil
from collections import deque
from pathlib import Path

from PIL import Image

SHEET_IDS = ("base", "punch", "kick", "special_1", "special_2")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Contour-normalize a 6x5 fighting-game sprite sheet.")
    parser.add_argument("source", type=Path, help="Generated source sheet.")
    parser.add_argument("output_dir", type=Path, help="Fighter output directory.")
    parser.add_argument("--character-id", required=True)
    parser.add_argument("--projectile-id", required=True)
    parser.add_argument("--projectile-index", type=int, required=True, help="0-based source slot index for projectile/VFX.")
    parser.add_argument("--description", type=Path, required=True)
    parser.add_argument("--moveset", type=Path, required=True)
    parser.add_argument("--special2-indices", default="24,25,26,27,29,29")
    parser.add_argument("--cols", type=int, default=6)
    parser.add_argument("--rows", type=int, default=5)
    parser.add_argument("--min-component-pixels", type=int, default=80)
    return parser.parse_args()


def is_background(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, _alpha = pixel
    return max(red, green, blue) - min(red, green, blue) <= 16 and (red + green + blue) / 3 >= 212


def remove_light_checker_background(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            if is_background(pixels[x, y]):
                pixels[x, y] = (255, 255, 255, 0)
    return image


def connected_components(image: Image.Image, min_pixels: int) -> list[dict[str, object]]:
    alpha = image.getchannel("A")
    alpha_pixels = alpha.load()
    width, height = image.size
    seen = bytearray(width * height)
    components: list[dict[str, object]] = []

    for y in range(height):
        for x in range(width):
            start_index = y * width + x
            if seen[start_index] or not alpha_pixels[x, y]:
                continue

            queue = deque([(x, y)])
            seen[start_index] = 1
            min_x = max_x = x
            min_y = max_y = y
            count = 0
            sum_x = 0
            sum_y = 0

            while queue:
                current_x, current_y = queue.popleft()
                count += 1
                sum_x += current_x
                sum_y += current_y
                min_x = min(min_x, current_x)
                max_x = max(max_x, current_x)
                min_y = min(min_y, current_y)
                max_y = max(max_y, current_y)

                for next_x, next_y in (
                    (current_x + 1, current_y),
                    (current_x - 1, current_y),
                    (current_x, current_y + 1),
                    (current_x, current_y - 1),
                ):
                    if 0 <= next_x < width and 0 <= next_y < height:
                        next_index = next_y * width + next_x
                        if not seen[next_index] and alpha_pixels[next_x, next_y]:
                            seen[next_index] = 1
                            queue.append((next_x, next_y))

            if count >= min_pixels:
                components.append(
                    {
                        "bbox": (min_x, min_y, max_x + 1, max_y + 1),
                        "count": count,
                        "center": (sum_x / count, sum_y / count),
                    }
                )

    return components


def components_in_slot(
    components: list[dict[str, object]],
    image_width: int,
    image_height: int,
    source_index: int,
    cols: int,
    rows: int,
) -> list[dict[str, object]]:
    col = source_index % cols
    row = source_index // cols
    x0 = col * image_width / cols
    x1 = (col + 1) * image_width / cols
    y0 = row * image_height / rows
    y1 = (row + 1) * image_height / rows

    selected = [
        component
        for component in components
        if x0 <= component["center"][0] < x1 and y0 <= component["center"][1] < y1
    ]
    if selected:
        return selected

    row_components = [component for component in components if y0 <= component["center"][1] < y1]
    if not row_components:
        return []

    target_x = (x0 + x1) / 2
    target_y = (y0 + y1) / 2
    return [
        min(
            row_components,
            key=lambda component: (component["center"][0] - target_x) ** 2 + (component["center"][1] - target_y) ** 2,
        )
    ]


def crop_component(image: Image.Image, component: dict[str, object], padding: int) -> Image.Image:
    left, top, right, bottom = component["bbox"]
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(image.width, right + padding)
    bottom = min(image.height, bottom + padding)
    return image.crop((left, top, right, bottom))


def frame_from_component(image: Image.Image, component: dict[str, object]) -> tuple[Image.Image, tuple[int, int]]:
    crop = crop_component(image, component, padding=36)
    crop = isolate_largest_component(crop)

    bbox = crop.getchannel("A").getbbox()
    if bbox:
        left, top, right, bottom = bbox
        crop = crop.crop((max(0, left - 10), max(0, top - 10), min(crop.width, right + 10), min(crop.height, bottom + 10)))

    min_width = 220
    min_height = 286
    floor_padding = 38
    width = max(crop.width + 80, min_width)
    height = max(crop.height + 58, min_height)
    output = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    offset_x = (width - crop.width) // 2
    offset_y = max(0, height - crop.height - floor_padding)
    output.alpha_composite(crop, (offset_x, offset_y))
    return output, (width // 2, height - floor_padding)


def isolate_largest_component(image: Image.Image) -> Image.Image:
    alpha = image.getchannel("A")
    alpha_pixels = alpha.load()
    width, height = image.size
    seen = bytearray(width * height)
    largest_pixels: list[tuple[int, int]] = []

    for y in range(height):
        for x in range(width):
            start_index = y * width + x
            if seen[start_index] or not alpha_pixels[x, y]:
                continue

            queue = deque([(x, y)])
            seen[start_index] = 1
            pixels: list[tuple[int, int]] = []

            while queue:
                current_x, current_y = queue.popleft()
                pixels.append((current_x, current_y))
                for next_x, next_y in (
                    (current_x + 1, current_y),
                    (current_x - 1, current_y),
                    (current_x, current_y + 1),
                    (current_x, current_y - 1),
                ):
                    if 0 <= next_x < width and 0 <= next_y < height:
                        next_index = next_y * width + next_x
                        if not seen[next_index] and alpha_pixels[next_x, next_y]:
                            seen[next_index] = 1
                            queue.append((next_x, next_y))

            if len(pixels) > len(largest_pixels):
                largest_pixels = pixels

    if not largest_pixels:
        return image

    mask = Image.new("L", image.size, 0)
    mask_pixels = mask.load()
    for x, y in largest_pixels:
        mask_pixels[x, y] = alpha_pixels[x, y]

    output = Image.new("RGBA", image.size, (0, 0, 0, 0))
    output.alpha_composite(image)
    output.putalpha(mask)
    return output


def projectile_from_components(image: Image.Image, components: list[dict[str, object]]) -> Image.Image:
    if not components:
        return Image.new("RGBA", (96, 64), (0, 0, 0, 0))

    # Projectiles/VFX can legitimately be composed of droplets/trails, so keep
    # every contour whose center lands in the projectile slot.
    left = min(component["bbox"][0] for component in components)
    top = min(component["bbox"][1] for component in components)
    right = max(component["bbox"][2] for component in components)
    bottom = max(component["bbox"][3] for component in components)
    crop = image.crop((max(0, left - 18), max(0, top - 18), min(image.width, right + 18), min(image.height, bottom + 18)))
    bbox = crop.getchannel("A").getbbox()
    if not bbox:
        return crop
    left, top, right, bottom = bbox
    return crop.crop((max(0, left - 8), max(0, top - 8), min(crop.width, right + 8), min(crop.height, bottom + 8)))


def touches_edge(image: Image.Image) -> bool:
    alpha = image.getchannel("A")
    return any(alpha.getpixel((x, 0)) or alpha.getpixel((x, image.height - 1)) for x in range(image.width)) or any(
        alpha.getpixel((0, y)) or alpha.getpixel((image.width - 1, y)) for y in range(image.height)
    )


def assemble_sheet(frame_dir: Path, output_path: Path) -> None:
    frames = [Image.open(path).convert("RGBA") for path in sorted(frame_dir.glob("*.png"))]
    cell_width = max(frame.width for frame in frames)
    cell_height = max(frame.height for frame in frames)
    sheet = Image.new("RGBA", (cell_width * len(frames), cell_height), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        x = index * cell_width + (cell_width - frame.width) // 2
        y = cell_height - frame.height
        sheet.alpha_composite(frame, (x, y))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output_path)


def write_manifest(output_dir: Path, root_label: str) -> None:
    manifest = {
        "character_description": (output_dir / "description.txt").read_text(encoding="utf-8").strip(),
        "moveset": {},
        "sheet_paths": {},
        "sprite_paths": {},
        "frame_counts": {},
    }
    for sheet_id in SHEET_IDS:
        manifest["sheet_paths"][sheet_id] = f"/{root_label}/sheets/{sheet_id}.png"
        sprite_paths = sorted((output_dir / "sprites" / sheet_id).glob("*.png"))
        manifest["sprite_paths"][sheet_id] = [f"/{root_label}/sprites/{sheet_id}/{path.name}" for path in sprite_paths]
        manifest["frame_counts"][sheet_id] = len(sprite_paths)
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    output_dir = args.output_dir.resolve()
    if output_dir.exists():
        shutil.rmtree(output_dir)

    for path in ("source", "sheets", "projectiles"):
        (output_dir / path).mkdir(parents=True, exist_ok=True)
    sprites_dir = output_dir / "sprites"
    sprites_dir.mkdir()

    shutil.copy2(args.source, output_dir / "source" / f"{args.character_id}_imagegen_sheet.png")
    image = remove_light_checker_background(args.source)
    image.save(output_dir / "source" / f"{args.character_id}_clean.png")

    components = connected_components(image, min_pixels=args.min_component_pixels)
    source_indices = {
        "base": [0, 1, 2, 3, 4, 5],
        "punch": [6, 7, 8, 9, 10, 11],
        "kick": [12, 13, 14, 15, 16, 17],
        "special_1": [18, 19, 20, 21, 22, 23],
        "special_2": [int(value) for value in args.special2_indices.split(",")],
    }

    frame_data = {
        "anchorConvention": "frame anchor is the character pivot/feet, in pixels from each PNG top-left",
        "frames": {},
    }
    report = {"source": str(args.source), "componentCount": len(components), "warnings": [], "frames": {}}

    for sheet_id, indices in source_indices.items():
        frame_data["frames"][sheet_id] = []
        report["frames"][sheet_id] = []
        frame_dir = sprites_dir / sheet_id
        frame_dir.mkdir()

        for frame_number, source_index in enumerate(indices, start=1):
            selected = components_in_slot(components, image.width, image.height, source_index, args.cols, args.rows)
            dominant = max(selected, key=lambda component: component["count"]) if selected else None
            frame, anchor = frame_from_component(image, dominant) if dominant else (Image.new("RGBA", (220, 286), (0, 0, 0, 0)), (110, 248))
            relative_file = f"sprites/{sheet_id}/{sheet_id}_{frame_number:03d}.png"
            frame.save(output_dir / relative_file)

            edge_touch = touches_edge(frame)
            if edge_touch:
                report["warnings"].append(f"{relative_file} touches output edge")

            meta = {
                "file": relative_file,
                "width": frame.width,
                "height": frame.height,
                "anchor": {"x": anchor[0], "y": anchor[1]},
            }
            frame_data["frames"][sheet_id].append(meta)
            report["frames"][sheet_id].append(
                {
                    **meta,
                    "edgeTouch": edge_touch,
                    "sourceIndex": source_index,
                    "sourceComponents": len(selected),
                    "keptComponentPixels": dominant["count"] if dominant else 0,
                }
            )

        assemble_sheet(frame_dir, output_dir / "sheets" / f"{sheet_id}.png")

    projectile_components = components_in_slot(components, image.width, image.height, args.projectile_index, args.cols, args.rows)
    projectile = projectile_from_components(image, projectile_components)
    projectile.save(output_dir / "projectiles" / f"{args.projectile_id}.png")
    report["projectile"] = {
        "file": f"projectiles/{args.projectile_id}.png",
        "width": projectile.width,
        "height": projectile.height,
        "sourceIndex": args.projectile_index,
        "sourceComponents": len(projectile_components),
    }

    shutil.copy2(args.description, output_dir / "description.txt")
    shutil.copy2(args.moveset, output_dir / "moveset.txt")
    (output_dir / "frameData.json").write_text(json.dumps(frame_data, indent=2) + "\n", encoding="utf-8")
    (output_dir / "normalization-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    write_manifest(output_dir, f"fighters/{args.character_id}")
    print(json.dumps({"output": str(output_dir), "warnings": report["warnings"], "projectile": report["projectile"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
