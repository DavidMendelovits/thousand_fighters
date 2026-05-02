#!/usr/bin/env python3
"""Build the Hair Hanger fighter pack from image-generated source sheets.

The source art is generated from the user's acrobatic hair-hanger reference
photo, then normalized into the engine's fixed 6-frame fighter-sheet contract.
"""

from __future__ import annotations

import json
import shutil
from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "fighters" / "hair_hanger"
REFERENCE = Path("/Users/davidmendelovits/Downloads/David Web Photos/Copy of stamptown-august-22-2024-26.jpg")
RAW_FULL_GENERATED = Path(
    "/Users/davidmendelovits/.codex/generated_images/019dea31-87e1-7dc3-812e-9ccfe1ffadf4/"
    "ig_0261dba803058b460169f66c63335481988d1eb914d4fea7fb.png"
)
RAW_HAIRPIN_GENERATED = Path(
    "/Users/davidmendelovits/.codex/generated_images/019dea31-87e1-7dc3-812e-9ccfe1ffadf4/"
    "ig_0261dba803058b460169f66d34048081988d325bdc9c5f1067.png"
)
RAW_BASE_GENERATED = Path(
    "/Users/davidmendelovits/.codex/generated_images/019dea31-87e1-7dc3-812e-9ccfe1ffadf4/"
    "ig_0261dba803058b460169f67921c10c81988b6d40bee9973204.png"
)
RAW_PUNCH_GENERATED = Path(
    "/Users/davidmendelovits/.codex/generated_images/019dea31-87e1-7dc3-812e-9ccfe1ffadf4/"
    "ig_0261dba803058b460169f67984dd888198aa7a756b22201107.png"
)

SHEETS = ("base", "punch", "kick", "special_1", "special_2")
FRAME_W = 320
FRAME_H = 360
ANCHOR = {"x": 160, "y": 320}
FRAME_SIZES = {
    "punch": (448, 360),
}
ANCHORS = {
    "punch": {"x": 160, "y": 320},
}
TARGET_HEIGHTS = {
    "base": 276,
    "punch": 286,
    "kick": 286,
    "special_1": 292,
    "special_2": 288,
}


def source_path(filename: str, generated: Path) -> Path:
    if generated.exists():
        return generated
    existing = OUT / "source" / filename
    return existing if existing.exists() else generated


def is_magenta(pixel: tuple[int, int, int, int]) -> bool:
    r, g, b, a = pixel
    if a == 0:
        return True
    return r > 170 and b > 130 and g < 125 and (r + b) / 2 - g > 72


def cutout_from_cell(
    image: Image.Image,
    cols: int,
    rows: int,
    col: int,
    row: int,
    keep_projectile: bool = False,
    discard_left_strays: bool = False,
) -> Image.Image:
    rgba = image.convert("RGBA")
    width, height = rgba.size
    left = round(col * width / cols)
    right = round((col + 1) * width / cols)
    top = round(row * height / rows)
    bottom = round((row + 1) * height / rows)
    cell = rgba.crop((left, top, right, bottom))
    pixels = cell.load()
    mask = [[False for _ in range(cell.width)] for _ in range(cell.height)]

    for y in range(cell.height):
        for x in range(cell.width):
            pixel = pixels[x, y]
            if not is_magenta(pixel):
                mask[y][x] = True

    components = connected_components(mask, min_pixels=28)
    if not components:
        return Image.new("RGBA", (1, 1), (0, 0, 0, 0))

    if keep_projectile:
        selected = components
    else:
        # Keep the body and any attached/local effect pieces; discard tiny source
        # specks that can appear in generated magenta gutters.
        largest = components[0]["area"]
        primary_bbox = components[0]["bbox"]
        selected = []
        for component in components:
            x0, y0, x1, y1 = component["bbox"]
            center_y = (y0 + y1) / 2
            detached_top_fragment = component is not components[0] and center_y < cell.height * 0.18 and component["area"] < largest * 0.28
            detached_bottom_fragment = component is not components[0] and center_y > cell.height * 0.9 and component["area"] < largest * 0.18
            detached_left_fragment = discard_left_strays and component is not components[0] and x1 < primary_bbox[0] - 8
            if detached_top_fragment or detached_bottom_fragment or detached_left_fragment:
                continue
            if component is components[0] or component["area"] >= max(28, largest * 0.012):
                selected.append(component)

    min_x = min(component["bbox"][0] for component in selected)
    min_y = min(component["bbox"][1] for component in selected)
    max_x = max(component["bbox"][2] for component in selected)
    max_y = max(component["bbox"][3] for component in selected)
    pad = 10
    min_x = max(0, min_x - pad)
    min_y = max(0, min_y - pad)
    max_x = min(cell.width, max_x + pad)
    max_y = min(cell.height, max_y + pad)

    output = Image.new("RGBA", (max_x - min_x, max_y - min_y), (0, 0, 0, 0))
    output_pixels = output.load()
    selected_pixels = set()
    for component in selected:
        selected_pixels.update(component["pixels"])

    for y in range(min_y, max_y):
        for x in range(min_x, max_x):
            if (x, y) not in selected_pixels:
                continue
            r, g, b, a = pixels[x, y]
            # Neutralize magenta fringe left by antialiasing against the source key.
            if r > 170 and b > 130 and g < 145:
                r = max(g, min(r, 160))
                b = max(g, min(b, 160))
            output_pixels[x - min_x, y - min_y] = (r, g, b, a)

    bbox = output.getchannel("A").getbbox()
    return output.crop(bbox) if bbox else output


def connected_components(mask: list[list[bool]], min_pixels: int) -> list[dict[str, object]]:
    height = len(mask)
    width = len(mask[0]) if height else 0
    seen = [[False for _ in range(width)] for _ in range(height)]
    components: list[dict[str, object]] = []
    neighbors = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1))

    for y in range(height):
        for x in range(width):
            if seen[y][x] or not mask[y][x]:
                continue
            queue = deque([(x, y)])
            seen[y][x] = True
            pixels: list[tuple[int, int]] = []
            min_x = max_x = x
            min_y = max_y = y
            while queue:
                current_x, current_y = queue.popleft()
                pixels.append((current_x, current_y))
                min_x = min(min_x, current_x)
                max_x = max(max_x, current_x)
                min_y = min(min_y, current_y)
                max_y = max(max_y, current_y)
                for dx, dy in neighbors:
                    next_x = current_x + dx
                    next_y = current_y + dy
                    if 0 <= next_x < width and 0 <= next_y < height and not seen[next_y][next_x] and mask[next_y][next_x]:
                        seen[next_y][next_x] = True
                        queue.append((next_x, next_y))
            if len(pixels) >= min_pixels:
                components.append(
                    {
                        "pixels": pixels,
                        "area": len(pixels),
                        "bbox": (min_x, min_y, max_x + 1, max_y + 1),
                    }
                )

    return sorted(components, key=lambda component: int(component["area"]), reverse=True)


def normalize_frame(cutout: Image.Image, sheet: str) -> Image.Image:
    target_height = TARGET_HEIGHTS[sheet]
    frame_w, frame_h = FRAME_SIZES.get(sheet, (FRAME_W, FRAME_H))
    anchor = ANCHORS.get(sheet, ANCHOR)
    max_width = frame_w - 36
    scale = min(target_height / cutout.height, max_width / cutout.width)
    scaled = cutout.resize((max(1, round(cutout.width * scale)), max(1, round(cutout.height * scale))), Image.Resampling.NEAREST)
    output = Image.new("RGBA", (frame_w, frame_h), (0, 0, 0, 0))
    x = anchor["x"] - scaled.width // 2
    y = anchor["y"] - scaled.height
    output.alpha_composite(scaled, (x, y))
    return output


def extract_projectile(hairpin_sheet: Image.Image) -> Image.Image:
    rgba = hairpin_sheet.convert("RGBA")
    width, height = rgba.size
    left = round(4 * width / 6)
    right = round(5 * width / 6)
    cell = rgba.crop((left, 0, right, height))
    pixels = cell.load()
    output = Image.new("RGBA", cell.size, (0, 0, 0, 0))
    output_pixels = output.load()
    for y in range(cell.height):
        for x in range(cell.width):
            if x < cell.width * 0.74:
                continue
            pixel = pixels[x, y]
            if is_magenta(pixel):
                continue
            output_pixels[x, y] = pixel

    bbox = output.getchannel("A").getbbox()
    if not bbox:
        crop = output
    else:
        lane = output.crop(bbox)
        alpha = lane.getchannel("A")
        mask = [[alpha.getpixel((x, y)) > 0 for x in range(lane.width)] for y in range(lane.height)]
        components = connected_components(mask, min_pixels=4)
        if len(components) > 1:
            # The largest component in this lane can still be fingertips; keep
            # the smaller separated hairpin/spark components.
            selected = components[1:]
            min_x = min(component["bbox"][0] for component in selected)
            min_y = min(component["bbox"][1] for component in selected)
            max_x = max(component["bbox"][2] for component in selected)
            max_y = max(component["bbox"][3] for component in selected)
            projectile = Image.new("RGBA", lane.size, (0, 0, 0, 0))
            projectile_pixels = projectile.load()
            lane_pixels = lane.load()
            selected_pixels = set()
            for component in selected:
                selected_pixels.update(component["pixels"])
            for y in range(lane.height):
                for x in range(lane.width):
                    if (x, y) in selected_pixels:
                        projectile_pixels[x, y] = lane_pixels[x, y]
            crop = projectile.crop((max(0, min_x - 4), max(0, min_y - 4), min(lane.width, max_x + 4), min(lane.height, max_y + 4)))
        else:
            crop = lane
    if crop.width > 140:
        scale = 140 / crop.width
        crop = crop.resize((140, max(1, round(crop.height * scale))), Image.Resampling.NEAREST)
    return crop


def extract_accessory(full_sheet: Image.Image) -> Image.Image:
    first = cutout_from_cell(full_sheet, 6, 5, 0, 0)
    alpha = first.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        return Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    # Top rig and wrapped bun connection, kept separate for the engine's
    # suspension overlay. It intentionally excludes most of the face/body.
    left = max(0, bbox[0] - 6)
    top = bbox[1]
    right = min(first.width, bbox[2] + 6)
    bottom = min(first.height, bbox[1] + 42)
    return first.crop((left, top, right, bottom))


def touches_edge(image: Image.Image) -> bool:
    alpha = image.getchannel("A")
    return any(alpha.getpixel((x, 0)) or alpha.getpixel((x, image.height - 1)) for x in range(image.width)) or any(
        alpha.getpixel((0, y)) or alpha.getpixel((image.width - 1, y)) for y in range(image.height)
    )


def assemble_sheet(frame_dir: Path, output_path: Path) -> None:
    frames = [Image.open(path).convert("RGBA") for path in sorted(frame_dir.glob("*.png"))]
    sheet = Image.new("RGBA", (sum(frame.width for frame in frames), max(frame.height for frame in frames)), (0, 0, 0, 0))
    x = 0
    for index, frame in enumerate(frames):
        sheet.alpha_composite(frame, (x, 0))
        x += frame.width
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output_path)


def write_text_files() -> tuple[str, str]:
    description = (
        "The Hair Hanger is a suspended acrobatic fighter based on the supplied Stamptown reference photo: "
        "a performer hanging from a wrapped high bun attached to a metal ring, wearing a tied white shirt over a red performance top, "
        "red bottoms, visible tattoos, and bright yellow-orange striped socks. She never plants on the floor and fights by tucking, swinging, "
        "hairpin tossing, and spinning around the hair-hanging point.\n"
        "Silhouette: compact suspended acrobat, high wrapped bun and metal ring above the head, one knee often tucked.\n"
        "Clothing: tied white shirt, red/pink performance top and bottoms, yellow-orange striped socks.\n"
        "Accessories: hair-hanging rig, wrapped bun tie, small metal hairpin projectile.\n"
        "Distinctive traits: tattoo flashes, stage grin, green stage-light spin trails."
    )
    moveset = "\n".join(
        [
            "[punch]",
            "name=Encore Wave",
            "description=Fast open-hand slap while dangling from the hair rig.",
            "",
            "[kick]",
            "name=Sock Sweep",
            "description=Knee-tuck into a bright-socked side kick from the hanging pivot.",
            "",
            "[special_1]",
            "name=Hairpin Toss",
            "description=Pulls a hairpin from the wrapped bun and throws it forward as a sparkling projectile.",
            "",
            "[special_2]",
            "name=Crown Spin",
            "description=Spins around the hair-hanging point with narrow side frames and green stage-light trails.",
        ]
    )
    (OUT / "description.txt").write_text(description + "\n", encoding="utf-8")
    (OUT / "moveset.txt").write_text(moveset + "\n", encoding="utf-8")
    return description, moveset


def main() -> int:
    full_source = source_path("hair_hanger_imagegen_sheet.png", RAW_FULL_GENERATED)
    hairpin_source = source_path("hair_hanger_hairpin_row_imagegen.png", RAW_HAIRPIN_GENERATED)
    base_source = source_path("hair_hanger_base_row_imagegen.png", RAW_BASE_GENERATED)
    punch_source = source_path("hair_hanger_punch_row_imagegen.png", RAW_PUNCH_GENERATED)
    if not full_source.exists() or not hairpin_source.exists() or not base_source.exists() or not punch_source.exists():
        raise FileNotFoundError("Missing generated Hair Hanger source sheet(s).")

    if OUT.exists():
        shutil.rmtree(OUT)
    for path in ("source", "sprites", "sheets", "projectiles", "accessories"):
        (OUT / path).mkdir(parents=True, exist_ok=True)

    shutil.copy2(REFERENCE, OUT / "source" / "hair_hanger_reference.jpg")
    shutil.copy2(full_source, OUT / "source" / "hair_hanger_imagegen_sheet.png")
    shutil.copy2(hairpin_source, OUT / "source" / "hair_hanger_hairpin_row_imagegen.png")
    shutil.copy2(base_source, OUT / "source" / "hair_hanger_base_row_imagegen.png")
    shutil.copy2(punch_source, OUT / "source" / "hair_hanger_punch_row_imagegen.png")

    full_sheet = Image.open(OUT / "source" / "hair_hanger_imagegen_sheet.png").convert("RGBA")
    hairpin_sheet = Image.open(OUT / "source" / "hair_hanger_hairpin_row_imagegen.png").convert("RGBA")
    base_sheet = Image.open(OUT / "source" / "hair_hanger_base_row_imagegen.png").convert("RGBA")
    punch_sheet = Image.open(OUT / "source" / "hair_hanger_punch_row_imagegen.png").convert("RGBA")

    source_slots = {
        "base": [(base_sheet, 6, 1, col, 0) for col in range(6)],
        "punch": [(punch_sheet, 6, 1, col, 0) for col in range(6)],
        "kick": [(full_sheet, 6, 5, col, 2) for col in range(6)],
        "special_1": [(hairpin_sheet, 6, 1, col, 0) for col in range(6)],
        "special_2": [(full_sheet, 6, 5, col, 4) for col in range(6)],
    }

    frame_data = {
        "anchorConvention": "frame anchor is the suspended lower-body pivot, in pixels from each PNG top-left",
        "frames": {},
    }
    manifest = {
        "character_description": "",
        "moveset": {},
        "sheet_paths": {},
        "sprite_paths": {},
        "frame_counts": {},
    }
    warnings: list[str] = []

    for sheet_id, slots in source_slots.items():
        frame_dir = OUT / "sprites" / sheet_id
        frame_dir.mkdir(parents=True, exist_ok=True)
        frame_data["frames"][sheet_id] = []
        manifest["sheet_paths"][sheet_id] = f"/fighters/hair_hanger/sheets/{sheet_id}.png"
        manifest["sprite_paths"][sheet_id] = []
        manifest["frame_counts"][sheet_id] = len(slots)

        for index, (source, cols, rows, col, row) in enumerate(slots, start=1):
            cutout = cutout_from_cell(source, cols, rows, col, row, discard_left_strays=sheet_id == "punch")
            frame = normalize_frame(cutout, sheet_id)
            relative = f"sprites/{sheet_id}/{sheet_id}_{index:03d}.png"
            frame.save(OUT / relative)
            if touches_edge(frame):
                warnings.append(f"{relative} touches output edge")
            frame_data["frames"][sheet_id].append(
                {"file": relative, "width": frame.width, "height": frame.height, "anchor": ANCHORS.get(sheet_id, ANCHOR)}
            )
            manifest["sprite_paths"][sheet_id].append(f"/fighters/hair_hanger/{relative}")

        assemble_sheet(frame_dir, OUT / "sheets" / f"{sheet_id}.png")

    extract_projectile(hairpin_sheet).save(OUT / "projectiles" / "hairpin_arc.png")
    extract_accessory(base_sheet).save(OUT / "accessories" / "hair_tie.png")
    description, _moveset = write_text_files()
    manifest["character_description"] = description
    (OUT / "frameData.json").write_text(json.dumps(frame_data, indent=2) + "\n", encoding="utf-8")
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (OUT / "normalization-report.json").write_text(
        json.dumps(
            {
                "source": "image-generated sheets from supplied reference photo",
                "rawSheets": {
                    "full": "source/hair_hanger_imagegen_sheet.png",
                    "hairpin": "source/hair_hanger_hairpin_row_imagegen.png",
                    "base": "source/hair_hanger_base_row_imagegen.png",
                    "punch": "source/hair_hanger_punch_row_imagegen.png",
                    "reference": "source/hair_hanger_reference.jpg",
                },
                "workflow": "docs/sprite-generation-memory.md frame pack layout, magenta cleanup, fixed runtime anchor",
                "spinningAnimation": "special_2 row from source sheet row 5",
                "warnings": warnings,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(OUT), "warnings": warnings}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
