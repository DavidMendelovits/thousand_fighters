#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "fighters" / "demi"
SOURCE = OUT / "source" / "demi_imagegen_sheet.png"
SHEETS = ("base", "punch", "kick", "special_1", "special_2")
FRAME_W = 320
FRAME_H = 320
ANCHOR = {"x": 160, "y": 286}
FRAME_PAD = 14
TOP_PAD = 16
MAX_UPSCALE = 1.42
SOURCE_INDICES = {
  "base": [0, 1, 2, 3, 4, 5],
  "punch": [6, 7, 8, 9, 10, 11],
  "kick": [12, 13, 14, 15, 16, 17],
  # The image-gen sheet's long laser occupies the fifth conceptual slot.
  # Runtime projectiles supply the beam, so use a clean recovery pose there.
  "special_1": [18, 19, 20, 21, 23, 23],
  "special_2": [24, 25, 26, 27, 28, 29],
}


def ensure_dirs() -> None:
  if not SOURCE.exists():
    raise SystemExit(f"missing image-gen source sheet: {SOURCE}")

  for child in ("sprites", "sheets", "projectiles"):
    path = OUT / child
    if path.exists():
      shutil.rmtree(path)

  for sheet in SHEETS:
    (OUT / "sprites" / sheet).mkdir(parents=True, exist_ok=True)
  (OUT / "sheets").mkdir(parents=True, exist_ok=True)
  (OUT / "projectiles").mkdir(parents=True, exist_ok=True)


def chroma_key(image: Image.Image) -> Image.Image:
  rgba = image.convert("RGBA")
  pixels = rgba.load()
  width, height = rgba.size
  for y in range(height):
    for x in range(width):
      r, g, b, a = pixels[x, y]
      magenta_distance = abs(r - 255) + abs(g - 0) + abs(b - 255)
      if a < 36:
        pixels[x, y] = (r, g, b, 0)
      elif r > 176 and b > 176 and g < 112 and magenta_distance < 210:
        pixels[x, y] = (r, g, b, 0)
      elif r > 144 and b > 144 and g < 132 and abs(r - b) < 84:
        pixels[x, y] = (r, g, b, 0)
      elif r > 92 and b > 92 and g < 92 and abs(r - b) < 110:
        pixels[x, y] = (r, g, b, 0)
      elif r > 48 and b > 48 and g < 72 and abs(r - b) < 96 and r + b > 132:
        pixels[x, y] = (r, g, b, 0)
      elif r > g + 24 and b > g + 24 and abs(r - b) < 96:
        neutral = max(0, min(r, g, b))
        pixels[x, y] = (neutral, neutral, neutral, a)
  return rgba


def source_slot_bounds(image: Image.Image, source_index: int) -> tuple[float, float, float, float]:
  row = source_index // 6
  col = source_index % 6
  return (
    col * image.width / 6,
    row * image.height / len(SHEETS),
    (col + 1) * image.width / 6,
    (row + 1) * image.height / len(SHEETS),
  )


def connected_components(image: Image.Image, min_pixels = 36) -> list[dict[str, object]]:
  pixels = image.load()
  width, height = image.size
  seen = bytearray(width * height)
  components: list[dict[str, object]] = []

  for y in range(height):
    for x in range(width):
      start_index = y * width + x
      if seen[start_index] or pixels[x, y][3] == 0:
        continue

      queue = deque([(x, y)])
      seen[start_index] = 1
      component_pixels: list[tuple[int, int]] = []
      min_x = max_x = x
      min_y = max_y = y
      sum_x = sum_y = 0
      sum_r = sum_g = sum_b = 0

      while queue:
        current_x, current_y = queue.popleft()
        r, g, b, _ = pixels[current_x, current_y]
        component_pixels.append((current_x, current_y))
        sum_x += current_x
        sum_y += current_y
        sum_r += r
        sum_g += g
        sum_b += b
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
          if not (0 <= next_x < width and 0 <= next_y < height):
            continue
          next_index = next_y * width + next_x
          if seen[next_index] or pixels[next_x, next_y][3] == 0:
            continue
          seen[next_index] = 1
          queue.append((next_x, next_y))

      count = len(component_pixels)
      if count < min_pixels:
        continue
      components.append(
        {
          "bbox": (min_x, min_y, max_x + 1, max_y + 1),
          "center": (sum_x / count, sum_y / count),
          "avg": (sum_r / count, sum_g / count, sum_b / count),
          "count": count,
          "pixels": component_pixels,
        }
      )

  return components


def components_for_slot(components: list[dict[str, object]], image: Image.Image, source_index: int) -> list[dict[str, object]]:
  left, top, right, bottom = source_slot_bounds(image, source_index)
  selected = [
    component
    for component in components
    if left <= component["center"][0] < right and top <= component["center"][1] < bottom
  ]
  if selected:
    return selected

  target_x = (left + right) / 2
  target_y = (top + bottom) / 2
  row_candidates = [
    component
    for component in components
    if top <= component["center"][1] < bottom
  ]
  if not row_candidates:
    return []
  return [
    min(
      row_candidates,
      key=lambda component: (component["center"][0] - target_x) ** 2 + (component["center"][1] - target_y) ** 2,
    )
  ]


def is_baked_projectile_effect(pixel: tuple[int, int, int, int]) -> bool:
  r, g, b, a = pixel
  if a == 0:
    return False
  bright_beam_core = r > 180 and g > 190 and b > 190 and max(r, g, b) - min(r, g, b) < 70
  cyan_or_blue = b > 125 and g > 90 and b > r + 28
  purple_spark = b > 120 and r > 80 and g < 140 and b > g + 35
  return bright_beam_core or cyan_or_blue or purple_spark


def projectile_effect_components(image: Image.Image) -> list[dict[str, object]]:
  effect_mask = Image.new("RGBA", image.size, (0, 0, 0, 0))
  input_pixels = image.load()
  mask_pixels = effect_mask.load()
  for y in range(image.height):
    for x in range(image.width):
      if is_baked_projectile_effect(input_pixels[x, y]):
        mask_pixels[x, y] = input_pixels[x, y]
  return connected_components(effect_mask, min_pixels=1)


def strip_baked_projectile_effects(image: Image.Image, sheet: str) -> Image.Image:
  if sheet not in {"punch", "special_1"}:
    return image

  output = image.copy()
  removed = Image.new("1", output.size, 0)
  removed_pixels = removed.load()
  pixels = output.load()
  for component in projectile_effect_components(output):
    left, top, right, bottom = component["bbox"]
    width = right - left
    height = bottom - top
    should_remove = width >= 18 or height >= 18 or (component["count"] >= 110 and width >= 12 and height >= 12)
    if not should_remove:
      continue
    for x, y in component["pixels"]:
      r, g, b, _ = pixels[x, y]
      pixels[x, y] = (r, g, b, 0)
      removed_pixels[x, y] = 1

  # The beam is sometimes antialiased into dim gray/blue pixels adjacent to
  # the removed core; remove those neighbors after the obvious effect pass.
  for _ in range(2):
    transparent_effect_neighbors: list[tuple[int, int]] = []
    for y in range(output.height):
      for x in range(output.width):
        r, g, b, a = pixels[x, y]
        if a == 0:
          continue
        dim_beam_fringe = b > 88 and g > 72 and (b > r + 18 or max(r, g, b) - min(r, g, b) < 36)
        if not dim_beam_fringe:
          continue
        near_removed_effect = any(
          0 <= nx < output.width and 0 <= ny < output.height and removed_pixels[nx, ny]
          for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
        )
        if near_removed_effect:
          transparent_effect_neighbors.append((x, y))
    for x, y in transparent_effect_neighbors:
      r, g, b, _ = pixels[x, y]
      pixels[x, y] = (r, g, b, 0)
      removed_pixels[x, y] = 1
  return output


def remove_projectile_bearing_components(image: Image.Image, components: list[dict[str, object]], sheet: str) -> list[dict[str, object]]:
  if sheet not in {"punch", "special_1"}:
    return components

  filtered = []
  for component in components:
    left, top, right, bottom = component["bbox"]
    width = right - left
    height = bottom - top
    avg_r, avg_g, avg_b = component["avg"]
    looks_like_free_projectile = width > 48 and height < 48 and (avg_b > 115 or avg_g > 115)
    if not looks_like_free_projectile:
      filtered.append(component)
  return filtered


def assert_actor_frames_do_not_embed_projectiles(frames: dict[str, list[Image.Image]], report: dict[str, object]) -> None:
  for sheet in ("punch", "special_1"):
    for index, frame in enumerate(frames[sheet], start=1):
      for component in projectile_effect_components(frame):
        left, top, right, bottom = component["bbox"]
        width = right - left
        height = bottom - top
        if width >= 18 or height >= 18 or (component["count"] >= 110 and width >= 12 and height >= 12):
          report["warnings"].append(
            f"sprites/{sheet}/{sheet}_{index:03d}.png may still contain baked projectile pixels"
          )
          break


def compose_components(image: Image.Image, components: list[dict[str, object]], padding: int) -> Image.Image:
  if not components:
    return Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))

  left = max(0, min(component["bbox"][0] for component in components) - padding)
  top = max(0, min(component["bbox"][1] for component in components) - padding)
  right = min(image.width, max(component["bbox"][2] for component in components) + padding)
  bottom = min(image.height, max(component["bbox"][3] for component in components) + padding)
  source_pixels = image.load()
  output = Image.new("RGBA", (right - left, bottom - top), (0, 0, 0, 0))
  output_pixels = output.load()

  for component in components:
    for source_x, source_y in component["pixels"]:
      if left <= source_x < right and top <= source_y < bottom:
        output_pixels[source_x - left, source_y - top] = source_pixels[source_x, source_y]

  return output


def fit_to_frame(source: Image.Image, sheet: str) -> Image.Image:
  cleaned = strip_baked_projectile_effects(source, sheet)
  bbox = alpha_bbox(cleaned)
  frame = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
  if not bbox:
    return frame

  crop = cleaned.crop(bbox)
  max_width = FRAME_W - FRAME_PAD * 2
  max_height = ANCHOR["y"] - TOP_PAD
  scale = min(max_width / crop.width, max_height / crop.height, MAX_UPSCALE)
  resized = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))), Image.Resampling.LANCZOS)
  x = round(ANCHOR["x"] - resized.width / 2)
  y = round(ANCHOR["y"] - resized.height)
  frame.alpha_composite(resized, (x, y))
  return frame


def slice_frames() -> tuple[dict[str, list[Image.Image]], dict[str, object], Image.Image]:
  raw = Image.open(SOURCE).convert("RGBA")
  keyed = chroma_key(raw)
  components = connected_components(keyed)
  frames: dict[str, list[Image.Image]] = {}
  report: dict[str, object] = {
    "source": "source/demi_imagegen_sheet.png",
    "method": "component extraction from whole image-gen sheet, magenta chroma-key removal, projectile layer split, padded fixed 320x320 frames",
    "frameSize": [FRAME_W, FRAME_H],
    "anchor": ANCHOR,
    "componentCount": len(components),
    "warnings": [],
    "frames": {},
  }

  for sheet in SHEETS:
    frames[sheet] = []
    report["frames"][sheet] = []
    for output_index, source_index in enumerate(SOURCE_INDICES[sheet], start=1):
      selected = components_for_slot(components, keyed, source_index)
      selected = remove_projectile_bearing_components(keyed, selected, sheet)
      composed = compose_components(keyed, selected, padding=14)
      frame = fit_to_frame(composed, sheet)
      frames[sheet].append(frame)

      source_left, source_top, source_right, source_bottom = source_slot_bounds(keyed, source_index)
      source_bleed = [
        component["bbox"]
        for component in selected
        if component["bbox"][0] < source_left
        or component["bbox"][1] < source_top
        or component["bbox"][2] > source_right
        or component["bbox"][3] > source_bottom
      ]
      bbox = alpha_bbox(frame)
      edge_touch = touches_edge(frame)
      if edge_touch:
        report["warnings"].append(f"sprites/{sheet}/{sheet}_{output_index:03d}.png touches output edge")
      report["frames"][sheet].append(
        {
          "file": f"sprites/{sheet}/{sheet}_{output_index:03d}.png",
          "sourceIndex": source_index,
          "sourceComponents": len(selected),
          "correctedSourceGridBleed": len(source_bleed),
          "bbox": bbox,
          "edgeTouch": edge_touch,
        }
      )

  assert_actor_frames_do_not_embed_projectiles(frames, report)
  return frames, report, keyed


def save_frames(frames: dict[str, list[Image.Image]]) -> None:
  for sheet, sheet_frames in frames.items():
    sheet_image = Image.new("RGBA", (FRAME_W * len(sheet_frames), FRAME_H), (0, 0, 0, 0))
    for index, frame in enumerate(sheet_frames, start=1):
      frame_path = OUT / "sprites" / sheet / f"{sheet}_{index:03d}.png"
      frame.save(frame_path)
      sheet_image.alpha_composite(frame, ((index - 1) * FRAME_W, 0))
    sheet_image.save(OUT / "sheets" / f"{sheet}.png")


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
  return image.getchannel("A").getbbox()


def touches_edge(image: Image.Image) -> bool:
  alpha = image.getchannel("A")
  return any(alpha.getpixel((x, 0)) or alpha.getpixel((x, image.height - 1)) for x in range(image.width)) or any(
    alpha.getpixel((0, y)) or alpha.getpixel((image.width - 1, y)) for y in range(image.height)
  )


def save_fit(source: Image.Image, out_path: Path, target: tuple[int, int], pad: int = 4) -> None:
  bbox = alpha_bbox(source)
  if not bbox:
    Image.new("RGBA", target, (0, 0, 0, 0)).save(out_path)
    return

  cropped = source.crop(bbox)
  max_w, max_h = target[0] - pad * 2, target[1] - pad * 2
  scale = min(max_w / cropped.width, max_h / cropped.height)
  resized = cropped.resize((max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale))), Image.Resampling.LANCZOS)
  canvas = Image.new("RGBA", target, (0, 0, 0, 0))
  canvas.alpha_composite(resized, ((target[0] - resized.width) // 2, (target[1] - resized.height) // 2))
  canvas.save(out_path)


def isolate_cyan(image: Image.Image) -> Image.Image:
  rgba = image.convert("RGBA")
  pixels = rgba.load()
  width, height = rgba.size
  for y in range(height):
    for x in range(width):
      r, g, b, a = pixels[x, y]
      if not (g > 130 and b > 150 and b > r + 45):
        pixels[x, y] = (r, g, b, 0)
  return rgba


def isolate_green(image: Image.Image) -> Image.Image:
  rgba = image.convert("RGBA")
  pixels = rgba.load()
  width, height = rgba.size
  for y in range(height):
    for x in range(width):
      r, g, b, a = pixels[x, y]
      if not (g > 120 and g > r + 30 and g > b + 20):
        pixels[x, y] = (r, g, b, 0)
  return rgba


def component_image(image: Image.Image, component: dict[str, object], padding: int) -> Image.Image:
  return compose_components(image, [component], padding=padding)


def source_slot_crop(image: Image.Image, source_index: int, padding: int) -> Image.Image:
  left, top, right, bottom = source_slot_bounds(image, source_index)
  return image.crop(
    (
      max(0, round(left) - padding),
      max(0, round(top) - padding),
      min(image.width, round(right) + padding),
      min(image.height, round(bottom) + padding),
    )
  )


def save_projectiles(keyed: Image.Image) -> None:
  cyan = isolate_cyan(keyed)
  cyan_components = connected_components(cyan, min_pixels=18)
  beam_components = [
    component
    for component in cyan_components
    if component["bbox"][2] - component["bbox"][0] > 48 and component["bbox"][2] - component["bbox"][0] > (component["bbox"][3] - component["bbox"][1]) * 1.8
  ]
  longest_beam = max(beam_components or cyan_components, key=lambda component: component["bbox"][2] - component["bbox"][0], default=None)
  laser_source = component_image(cyan, longest_beam, padding=8) if longest_beam else Image.new("RGBA", (224, 44), (0, 0, 0, 0))
  save_fit(laser_source, OUT / "projectiles" / "remote_laser.png", (224, 44), pad=2)

  spark_source = isolate_cyan(source_slot_crop(keyed, 19, padding=12))
  save_fit(spark_source, OUT / "projectiles" / "remote_spark.png", (64, 64), pad=4)

  green = isolate_green(keyed)
  green_components = connected_components(green, min_pixels=80)
  slot_left, slot_top, slot_right, slot_bottom = source_slot_bounds(green, 29)
  target = ((slot_left + slot_right) / 2, (slot_top + slot_bottom) / 2)
  morph_component = min(
    green_components,
    key=lambda component: (component["center"][0] - target[0]) ** 2 + (component["center"][1] - target[1]) ** 2,
    default=None,
  )
  morph_source = component_image(green, morph_component, padding=12) if morph_component else Image.new("RGBA", (92, 92), (0, 0, 0, 0))
  save_fit(morph_source, OUT / "projectiles" / "morph_flash.png", (92, 92), pad=4)


def write_metadata(report: dict[str, object]) -> None:
  frame_data = {
    "anchorConvention": "frame anchor is the character pivot/feet, in pixels from each PNG top-left",
    "source": "source/demi_imagegen_sheet.png",
    "frames": {
      sheet: [
        {
          "file": f"sprites/{sheet}/{sheet}_{index:03d}.png",
          "width": FRAME_W,
          "height": FRAME_H,
          "anchor": ANCHOR,
        }
        for index in range(1, 7)
      ]
      for sheet in SHEETS
    },
  }
  (OUT / "frameData.json").write_text(json.dumps(frame_data, indent=2) + "\n")

  (OUT / "description.txt").write_text(
    "\n".join(
      [
        "Demi is a ranged fighter generated from the dance-floor reference: yellow overalls, red suspenders, red shoes, dark locs gathered back with trailing strands, a full dark beard, and a handheld black remote.",
        "The remote drives his zoning game with cyan laser beams.",
        "A faceless green morphsuit assistant appears only for the Morph Toss Backflip special.",
      ]
    )
    + "\n"
  )

  (OUT / "moveset.txt").write_text(
    "\n".join(
      [
        "[punch]",
        "name=Remote Click",
        "description=Quick remote point that snaps a short cyan laser forward.",
        "",
        "[kick]",
        "name=Dance Floor Check",
        "description=Low dancer kick to keep opponents away.",
        "",
        "[special_1]",
        "name=Channel Changer",
        "description=Remote fires a long fast laser projectile across the stage.",
        "",
        "[special_2]",
        "name=Morph Toss Backflip",
        "description=Green morphsuit assistant appears, throws Demi forward, and Demi backflips into the opponent.",
      ]
    )
    + "\n"
  )

  manifest = {
    "id": "demi",
    "artSource": "image-gen",
    "source": "source/demi_imagegen_sheet.png",
    "description": "description.txt",
    "moveset": "moveset.txt",
    "frameData": "frameData.json",
    "sheets": {sheet: f"sheets/{sheet}.png" for sheet in SHEETS},
    "sprites": {
      sheet: [f"sprites/{sheet}/{sheet}_{index:03d}.png" for index in range(1, 7)]
      for sheet in SHEETS
    },
    "projectiles": {
      "remote_laser": "projectiles/remote_laser.png",
      "remote_spark": "projectiles/remote_spark.png",
      "morph_flash": "projectiles/morph_flash.png",
    },
  }
  (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

  (OUT / "normalization-report.json").write_text(json.dumps(report, indent=2) + "\n")


def main() -> None:
  ensure_dirs()
  frames, report, keyed = slice_frames()
  save_frames(frames)
  save_projectiles(keyed)
  write_metadata(report)
  print(f"processed image-gen Demi sheet into {OUT}")


if __name__ == "__main__":
  main()
