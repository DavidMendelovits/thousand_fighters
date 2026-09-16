#!/usr/bin/env python3
"""Compile layered PNG sequences or video into a pivot-stable animation package.

This compiler never fits individual silhouettes or drops disconnected parts.
Motion-adaptive selection is a heuristic; authored source-frame markers remain
the authority for impact poses and transformations. See docs/ANIMATION_CLIPS.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import subprocess
import tempfile
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageStat

MAX_SOURCE_FRAMES = 600
MAX_CANVAS = 2048
MAX_SOURCE_PIXELS = 4096 * 4096
ID = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")


def integer(value, name, low=0, high=100000):
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f"{name} must be an integer between {low} and {high}")
    return value


def point(value, name):
    if not isinstance(value, dict) or any(
        isinstance(value.get(k), bool) or not isinstance(value.get(k), (int, float))
        or not math.isfinite(value[k]) for k in ("x", "y")
    ):
        raise ValueError(f"{name} requires finite x and y")
    return {k: float(value[k]) for k in ("x", "y")}


def slug(value, name):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError(f"{name} must be a lowercase id, not a path")
    return value


def key_background(image, color, tolerance=48, mode="connected"):
    """Remove only key-colored pixels connected to the canvas exterior by default.

    Keep original alpha for PNGs and keep isolated key-colored costume details.
    Explicit 'all' mode is available for intentionally keyed enclosed holes.
    """
    image = image.convert("RGBA")
    if color in (None, "alpha", "none"):
        return image
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise ValueError("background must be alpha or a #rrggbb key color")
    if mode not in ("connected", "all", "chroma"):
        raise ValueError("backgroundMode must be connected, all, or chroma")
    integer(tolerance, "keyTolerance", 0, 255)
    rgb = tuple(int(color[i:i + 2], 16) for i in (1, 3, 5))
    if mode == "chroma":
        # Channel operations run in Pillow, avoiding Python per-pixel scans of video.
        if color.lower() not in ("#ff00ff", "#00ff00"):
            raise ValueError("chroma mode supports #ff00ff or #00ff00 only")
        red, green, blue, alpha = image.split()
        dominant, other = (ImageChops.darker(red, blue), green) if color.lower() == "#ff00ff" else (green, ImageChops.lighter(red, blue))
        difference = ImageChops.subtract(dominant, other).point(lambda p: 255 if p > 24 else 0)
        ratio = ImageChops.subtract(dominant, other.point(lambda p: min(255, round(p * 1.25)))).point(lambda p: 255 if p > 0 else 0)
        remove = ImageChops.multiply(difference, ratio)
        image.putalpha(ImageChops.multiply(alpha, ImageChops.invert(remove)))
        return image
    w, h = image.size
    data = list(image.getdata())
    candidates = bytearray(
        1 if p[3] == 0 or max(abs(p[k] - rgb[k]) for k in range(3)) <= tolerance else 0
        for p in data
    )
    if mode == "all":
        clear = candidates
    else:
        clear = bytearray(w * h)
        queue = deque()
        for i in set(list(range(w)) + list(range((h - 1) * w, h * w))
                     + list(range(0, w * h, w)) + list(range(w - 1, w * h, w))):
            if candidates[i]:
                clear[i] = 1
                queue.append(i)
        while queue:
            i = queue.popleft()
            x = i % w
            for n in (i - w if i >= w else -1, i + w if i < w * (h - 1) else -1,
                      i - 1 if x else -1, i + 1 if x < w - 1 else -1):
                if n >= 0 and candidates[n] and not clear[n]:
                    clear[n] = 1
                    queue.append(n)
    image.putdata([(p[0], p[1], p[2], 0) if clear[i] else p for i, p in enumerate(data)])
    return image


def run(command):
    return subprocess.run(command, check=True, capture_output=True, text=True, timeout=120).stdout


def load_source(source, base, scratch, pixel_budget=180_000_000):
    paths = source.get("frames")
    if bool(paths) == bool(source.get("video")):
        raise ValueError("Each source must specify either frames or video")
    timestamps = []
    video = None
    if source.get("video"):
        video = (base / source["video"]).resolve()
        if not video.is_file():
            raise ValueError(f"Missing source video: {video}")
        metadata = json.loads(run([
            "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_streams",
            "-read_intervals", f"%+#{MAX_SOURCE_FRAMES + 1}",
            "-show_frames", "-show_entries",
            "stream=width,height,avg_frame_rate,duration:frame=best_effort_timestamp_time",
            "-of", "json", str(video),
        ]))
        streams = metadata.get("streams", [])
        if not streams or streams[0]["width"] * streams[0]["height"] > MAX_SOURCE_PIXELS:
            raise ValueError("Video has no usable video stream or exceeds 4096² source pixels")
        raw_times = metadata.get("frames", [])
        if len(raw_times) > MAX_SOURCE_FRAMES:
            raise ValueError(f"Video exceeds {MAX_SOURCE_FRAMES} frames; trim it before compilation")
        if len(raw_times) * streams[0]["width"] * streams[0]["height"] > pixel_budget:
            raise ValueError("Source exceeds decoded pixel budget; downscale or trim before compilation")
        scratch.mkdir(parents=True)
        run(["ffmpeg", "-v", "error", "-i", str(video), "-map", "0:v:0", "-vsync", "0",
             "-frames:v", str(MAX_SOURCE_FRAMES + 1), str(scratch / "%05d.png")])
        paths = sorted(scratch.glob("*.png"))
        timestamps = [float(f["best_effort_timestamp_time"]) * 1000 for f in raw_times
                      if "best_effort_timestamp_time" in f]
        if timestamps:
            origin = timestamps[0]
            timestamps = [t - origin for t in timestamps]
    else:
        if not isinstance(paths, list):
            raise ValueError("source.frames must be an ordered list of PNG paths")
        paths = [(base / p).resolve() for p in paths]
    if not paths or len(paths) > MAX_SOURCE_FRAMES:
        raise ValueError(f"Sources need 1–{MAX_SOURCE_FRAMES} frames")
    fps = source.get("fps", 24)
    if isinstance(fps, bool) or not isinstance(fps, (int, float)) or not math.isfinite(fps) or fps <= 0:
        raise ValueError("source.fps must be positive")
    if len(timestamps) != len(paths):
        timestamps = [i * 1000 / fps for i in range(len(paths))]
    images = []
    digest = hashlib.sha256()
    decoded_pixels = 0
    for path in paths:
        with Image.open(path) as im:
            if im.width * im.height > MAX_SOURCE_PIXELS:
                raise ValueError("Source frame exceeds 4096² pixels")
            if images and im.size != images[0].size:
                raise ValueError("Frames within a source must share dimensions; use a common source canvas")
            decoded_pixels += im.width * im.height
            if decoded_pixels > pixel_budget:
                raise ValueError("Source exceeds decoded pixel budget; downscale or trim before compilation")
            digest.update(path.read_bytes())
            images.append(key_background(im, source.get("background"),
                                         source.get("keyTolerance", 48), source.get("backgroundMode", "connected")))
    return images, timestamps, {"sha256": digest.hexdigest(), "frameCount": len(images),
                                "video": str(video) if video else None, "size": list(images[0].size)}


def select_frames(images, selection):
    """Explicit semantic markers win; motion mode distributes the other samples.

    No pose detector is claimed: motion is measured with coarse RGBA differences.
    """
    if isinstance(selection, list):
        if not selection:
            raise ValueError("selection cannot be empty")
        for f in selection:
            integer(f.get("frame"), "selection.frame", 0, len(images) - 1)
            integer(f.get("durationTicks"), "durationTicks", 1, 3600)
        return selection
    selection = selection or {}
    mode = selection.get("mode", "motion")
    if mode not in ("motion", "uniform", "all"):
        raise ValueError("selection.mode must be motion, uniform, or all")
    start = integer(selection.get("startFrame", 0), "startFrame", 0, len(images) - 1)
    end = integer(selection.get("endFrame", len(images) - 1), "endFrame", start, len(images) - 1)
    count = min(integer(selection.get("frameCount", 12), "frameCount", 1, 240), end - start + 1)
    hold = integer(selection.get("durationTicks", 4), "durationTicks", 1, 3600)
    markers = {}
    for marker in selection.get("markers", []):
        index = integer(marker.get("frame"), "marker.frame", start, end)
        if index in markers:
            raise ValueError("Duplicate marker frame")
        integer(marker.get("durationTicks", hold), "marker.durationTicks", 1, 3600)
        markers[index] = marker
    if mode == "all":
        chosen = set(range(start, end + 1))
    else:
        chosen = {start, end} if count > 1 else {start}
        chosen.update(markers)
        if len(chosen) > count:
            raise ValueError("frameCount cannot accommodate endpoints and required markers")
        cumulative = [0.0]
        previous = images[start].resize((48, 48))
        for index in range(start + 1, end + 1):
            current = images[index].resize((48, 48))
            delta = sum(ImageStat.Stat(ImageChops.difference(previous, current)).mean) / 4
            cumulative.append(cumulative[-1] + (delta + 0.05 if mode == "motion" else 1))
            previous = current
        for i in range(1, count - 1):
            target = cumulative[-1] * i / (count - 1)
            candidates = [j for j in range(start, end + 1) if j not in chosen]
            if len(chosen) < count:
                chosen.add(min(candidates, key=lambda j: abs(cumulative[j - start] - target)))
        # Marker collisions can leave holes. Fill the widest remaining temporal gap.
        while len(chosen) < count:
            chosen.add(max((j for j in range(start, end + 1) if j not in chosen),
                           key=lambda j: min(abs(j - k) for k in chosen)))
    return [{"frame": i, "durationTicks": markers.get(i, {}).get("durationTicks", hold),
             **({"event": markers[i]["event"]} if "event" in markers.get(i, {}) else {})}
            for i in sorted(chosen)]


def shared_palette(images, colors=None, count=None):
    """Fit once across the clip, never independently per frame; preserve alpha."""
    if colors is not None:
        if not isinstance(colors, list) or not 2 <= len(colors) <= 256 or any(
            not isinstance(c, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", c) for c in colors
        ):
            raise ValueError("palette must contain 2–256 #rrggbb colors")
        rgb = [tuple(int(c[i:i+2], 16) for i in (1, 3, 5)) for c in colors]
    else:
        integer(count, "paletteSize", 2, 256)
        samples = []
        for image in images:
            sample = image.copy()
            sample.thumbnail((64, 64), Image.Resampling.NEAREST)
            samples.extend(p[:3] for p in sample.getdata() if p[3] > 0)
        if not samples:
            raise ValueError("Cannot fit a palette from an empty sequence")
        strip = Image.new("RGB", (len(samples), 1))
        strip.putdata(samples)
        fitted = strip.quantize(colors=count, method=Image.Quantize.MEDIANCUT)
        palette = fitted.getpalette()
        rgb = [tuple(palette[index:index+3]) for index in range(0, min(len(palette), count*3), 3)]
        rgb += [rgb[-1]] * (count - len(rgb))
        colors = ["#%02x%02x%02x" % c for c in rgb]
    reference = Image.new("P", (1, 1))
    padded = rgb + [rgb[-1]] * (256-len(rgb))
    reference.putpalette([channel for c in padded for channel in c])
    return reference, colors


def compile_clip(spec, base, output):
    clip_id = slug(spec.get("id"), "id")
    root_mode = spec.get("rootMode", "in-place")
    if root_mode not in ("in-place", "extract", "baked"):
        raise ValueError("rootMode must be in-place, extract, or baked")
    playback = spec.get("playback", "once")
    if playback not in ("once", "loop", "hold"):
        raise ValueError("playback must be once, loop, or hold")
    # Runtime visualTimeline durations are fixed 60 Hz combat ticks.
    tick_rate = integer(spec.get("tickRate", 60), "tickRate (gameplay timebase)", 60, 60)
    scale = spec.get("scale", 1)
    if isinstance(scale, bool) or not isinstance(scale, (int, float)) or not math.isfinite(scale) or not 0 < scale <= 8:
        raise ValueError("scale must be greater than 0 and at most 8")
    padding = integer(spec.get("padding", 4), "padding", 1, 128)
    definitions = spec.get("layers", [])
    if not 1 <= len(definitions) <= 8:
        raise ValueError("A clip requires 1–8 layers")
    if len({d.get("id") for d in definitions}) != len(definitions):
        raise ValueError("Layer ids must be unique")
    if output.exists():
        raise ValueError(f"Output already exists; choose a new version directory: {output}")
    warnings, checks, loaded = [], [], []
    with tempfile.TemporaryDirectory(prefix="tf-clip-") as temporary:
        for definition in definitions:
            layer_id = slug(definition.get("id"), "layer.id")
            remaining = 180_000_000 - sum(im.width * im.height for layer in loaded for im in layer["images"])
            images, times, provenance = load_source(definition["source"], base, Path(temporary) / layer_id, remaining)
            source = definition["source"]
            anchor = point(source.get("anchor"), f"{layer_id}.source.anchor")
            track = source.get("rootTrack")
            if track is not None and len(track) != len(images):
                raise ValueError("rootTrack must contain one point per source frame")
            roots = [point(p, "rootTrack") for p in track] if track else [anchor] * len(images)
            loaded.append({"definition": definition, "images": images, "times": times,
                           "anchor": anchor, "roots": roots, "provenance": provenance})
            if sum(im.width * im.height for layer in loaded for im in layer["images"]) > 180_000_000:
                raise ValueError("Source set exceeds 180M decoded pixels; downscale or trim the source first")
        source_count = len(loaded[0]["images"])
        if any(len(l["images"]) not in (1, source_count) for l in loaded):
            raise ValueError("Layers must have the primary frame count or one static frame")
        selected = select_frames(loaded[0]["images"], spec.get("selection"))
        if len(selected) > 240:
            raise ValueError("Select at most 240 output frames")
        resized_pixels = sum(max(1, round(l["images"][0].width * scale)) * max(1, round(l["images"][0].height * scale)) * len(selected) for l in loaded)
        if resized_pixels > 100_000_000:
            raise ValueError("Scaled working frames exceed 100M pixels; lower scale or frame count")
        # Shared union in root-relative space, across ALL poses and ALL layers.
        extents = []
        edge_frames, empty_primary = [], []
        transformed = []
        for layer_index, layer in enumerate(loaded):
            frames = []
            for selected_frame in selected:
                index = selected_frame["frame"] if len(layer["images"]) > 1 else 0
                im = layer["images"][index]
                bbox = im.getchannel("A").getbbox()
                root = layer["roots"][index]
                pivot = layer["anchor"] if root_mode == "baked" else root
                origin = {"x": round(-pivot["x"] * scale), "y": round(-pivot["y"] * scale)}
                resized = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.Resampling.NEAREST)
                scaled_box = resized.getchannel("A").getbbox()
                if scaled_box:
                    extents.append((scaled_box[0] + origin["x"], scaled_box[1] + origin["y"],
                                    scaled_box[2] + origin["x"], scaled_box[3] + origin["y"]))
                elif layer_index == 0:
                    empty_primary.append(index)
                if bbox and (bbox[0] == 0 or bbox[1] == 0 or bbox[2] == im.width or bbox[3] == im.height):
                    edge_frames.append(f"{layer['definition']['id']}:{index}")
                frames.append((resized, origin, index))
            transformed.append(frames)
        palette_colors = spec.get("palette")
        if palette_colors is not None or spec.get("paletteSize") is not None:
            palette, palette_colors = shared_palette(
                [frame[0] for layer in transformed for frame in layer], palette_colors, spec.get("paletteSize"))
            transformed = [[(
                Image.merge("RGBA", (*im.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE).convert("RGB").split(), im.getchannel("A"))),
                origin, source_index) for im, origin, source_index in layer] for layer in transformed]
        if not extents:
            raise ValueError("All selected layers are empty after background removal")
        left = min(b[0] for b in extents) - padding
        top = min(b[1] for b in extents) - padding
        right = max(b[2] for b in extents) + padding
        bottom = max(b[3] for b in extents) + padding
        width, height = right - left, bottom - top
        if width > MAX_CANVAS or height > MAX_CANVAS:
            raise ValueError(f"Union canvas {width}×{height} exceeds {MAX_CANVAS}; lower global scale")
        if width * height * len(selected) * len(loaded) > 100_000_000:
            raise ValueError("Decoded output exceeds 100M pixels; lower scale, layers, or frame count")
        anchor = {"x": -left, "y": -top}
        output.parent.mkdir(parents=True, exist_ok=True)
        # Publish the entire directory only after compilation succeeds.
        with tempfile.TemporaryDirectory(prefix=".clip-build-", dir=output.parent) as staging_name:
            staging = Path(staging_name)
            layers, composite_frames, frame_data = [], [], {}
            (staging / "layers").mkdir()
            for layer_index, layer in enumerate(loaded):
                definition = layer["definition"]
                layer_id = definition["id"]
                blend = definition.get("blend", "normal")
                if blend not in ("normal", "add"):
                    raise ValueError("layer.blend must be normal or add")
                z = definition.get("z", layer_index)
                if not isinstance(z, (int, float)) or not math.isfinite(z):
                    raise ValueError("layer.z must be finite")
                frame_dir = staging / "sprites" / layer_id
                frame_dir.mkdir(parents=True)
                columns = max(1, min(8, 4096 // width, len(selected)))
                rows = math.ceil(len(selected) / columns)
                if rows * height > 16384:
                    raise ValueError("Atlas exceeds 16384px height; reduce frame count/scale")
                sheet = Image.new("RGBA", (width * columns, height * rows))
                frames, rendered = [], []
                for index, (im, origin, source_index) in enumerate(transformed[layer_index]):
                    frame = Image.new("RGBA", (width, height))
                    frame.alpha_composite(im, (origin["x"] - left, origin["y"] - top))
                    x, y = (index % columns) * width, (index // columns) * height
                    sheet.alpha_composite(frame, (x, y))
                    filename = f"sprites/{layer_id}/{layer_id}_{index + 1:03d}.png"
                    frame.save(staging / filename)
                    root = layer["roots"][source_index]
                    root_motion = {k: round((root[k] - layer["anchor"][k]) * scale) if root_mode == "extract" else 0 for k in ("x", "y")}
                    socket_tracks = definition["source"].get("sockets", {})
                    sockets = {}
                    for name, track in socket_tracks.items():
                        if len(track) != len(layer["images"]):
                            raise ValueError(f"Socket {name} must contain one point per source frame")
                        if track[source_index] is not None:
                            p = point(track[source_index], f"socket {name}")
                            sockets[name] = {"x": round(p["x"] * scale) + origin["x"] - left,
                                             "y": round(p["y"] * scale) + origin["y"] - top}
                    frames.append({"x": x, "y": y, "width": width, "height": height,
                                   "file": filename, "durationTicks": selected[index]["durationTicks"],
                                   "sourceFrame": source_index, "sourceTimeMs": round(layer["times"][source_index], 3),
                                   "rootMotion": root_motion, "sockets": sockets,
                                   "empty": frame.getchannel("A").getbbox() is None})
                    rendered.append(frame)
                sheet_path = f"layers/{layer_id}.png"
                sheet.save(staging / sheet_path)
                layers.append({"id": layer_id, "role": definition.get("role", "body"), "z": z,
                               "blend": blend, "sheet": sheet_path, "frames": frames})
                frame_data[layer_id] = [{"file": f["file"], "width": width, "height": height,
                                         "anchor": anchor, "durationFrames": f["durationTicks"]} for f in frames]
                composite_frames.append((z, blend, rendered))
            composite = []
            for i in range(len(selected)):
                canvas = Image.new("RGBA", (width, height))
                for _, blend, frames in sorted(composite_frames, key=lambda entry: entry[0]):
                    # Review sheet uses source-over; live renderer honors additive blend.
                    canvas.alpha_composite(frames[i])
                composite.append(canvas)
            contact_cols = min(6, len(selected))
            contact = Image.new("RGBA", (width * contact_cols, height * math.ceil(len(selected) / contact_cols)))
            for i, frame in enumerate(composite):
                contact.alpha_composite(frame, ((i % contact_cols) * width, (i // contact_cols) * height))
            contact.save(staging / "contact-sheet.png")
            # Lossless animated preview, not a GIF with alpha/palette quantization.
            if len(composite) > 1:
                composite[0].save(staging / "preview.png", save_all=True, append_images=composite[1:],
                                  duration=[round(f["durationTicks"] * 1000 / tick_rate) for f in selected],
                                  loop=0 if playback == "loop" else 1, disposal=0, blend=0)
            else:
                composite[0].save(staging / "preview.png")
            events = list(spec.get("events", []))
            tick = 0
            for selection in selected:
                if selection.get("event"):
                    event = selection["event"]
                    events.append({**({"type": event, "label": event} if isinstance(event, str) else event), "tick": tick})
                tick += selection["durationTicks"]
            for event in events:
                integer(event.get("tick"), "event.tick", 0, tick - 1)
                if not isinstance(event.get("type"), str) or not event["type"]:
                    raise ValueError("Events require a nonempty type")
                event.setdefault("label", event["type"].replace("-", " ").title())
            events.sort(key=lambda e: e["tick"])
            if edge_frames:
                warnings.append("Source boundary touched; inspect possible clipping: " + ", ".join(edge_frames[:16]))
            if empty_primary:
                warnings.append("Primary layer is empty at source frames: " + ", ".join(map(str, empty_primary)))
            hashes = [hashlib.sha256(f.tobytes()).hexdigest() for f in composite]
            unique = len(set(hashes))
            if unique <= 1 and len(selected) > 1:
                warnings.append("No visible motion across selected frames; an intentional hold needs review")
            checks.extend([
                {"id": "shared-scale", "label": "Shared scale", "status": "pass", "detail": f"One {scale:g}× transform; no silhouette fitting"},
                {"id": "parts", "label": "Disconnected parts", "status": "pass", "detail": "All foreground components retained"},
                {"id": "clipping", "label": "Source framing", "status": "warn" if edge_frames else "pass", "detail": f"{len(edge_frames)} source boundary contacts"},
                {"id": "motion", "label": "Pose diversity", "status": "warn" if unique <= 1 else "pass", "detail": f"{unique} distinct selected composites; not a motion-quality score"},
                {"id": "review", "label": "Art and gameplay", "status": "warn", "detail": "Human review required; morphology, loop seams and combat timing are not automatically approved"},
            ])
            if any(layer["blend"] == "add" for layer in layers):
                warnings.append("Contact sheet/APNG use source-over; Animation Lab applies additive blending")
            clip = {"schemaVersion": 1, "id": clip_id, "displayName": spec.get("displayName", clip_id),
                    "kind": spec.get("kind", "action"), "playback": playback, "tickRate": tick_rate,
                    "totalTicks": tick, "canvas": {"width": width, "height": height}, "anchor": anchor,
                    "rootMode": root_mode, "layers": layers, "events": events,
                    "palette": palette_colors,
                    "intent": {"topologyChanges": False, "scaleChanges": False, "paletteChanges": False, **spec.get("intent", {})},
                    "qa": {"status": "needs-review", "checks": checks, "warnings": warnings},
                    "provenance": {**spec.get("provenance", {"method": "imported"}),
                                   "compiler": "animation-clip-v1", "scale": scale,
                                   "sources": [l["provenance"] for l in loaded]},
                    "review": {"contactSheet": "contact-sheet.png", "preview": "preview.png"}}
            (staging / "clip.json").write_text(json.dumps(clip, indent=2) + "\n")
            (staging / "frameData.json").write_text(json.dumps({"anchorConvention": "frame anchor is the actor pivot in PNG pixels", "frames": frame_data}, indent=2) + "\n")
            body_layer = next((layer for layer in layers if layer["role"] == "body"), layers[0])
            fragment = {"animation": clip_id, "tickRate": 60,
                        "visualTimeline": [{"frame": i, "duration": frame["durationTicks"]} for i, frame in enumerate(body_layer["frames"])],
                        "frameCounts": {clip_id: len(selected)},
                        "sprites": {clip_id: [frame["file"] for frame in body_layer["frames"]]},
                        "frameData": {"frames": {clip_id: frame_data[body_layer["id"]]}},
                        "events": events,
                        "note": "Review before import. Bind events/VFX/root motion deliberately; combat hitboxes are not inferred from art."}
            (staging / "runtime-fragment.json").write_text(json.dumps(fragment, indent=2) + "\n")
            (staging / "source-spec.json").write_text(json.dumps(spec, indent=2) + "\n")
            # Rename only into an unused version. Never delete a previous accepted pack.
            if output.exists():
                raise ValueError("Output appeared during compilation; refusing overwrite")
            staging.rename(output)
        return clip


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("spec", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        spec = json.loads(args.spec.read_text())
        result = compile_clip(spec, args.spec.resolve().parent, args.output.resolve())
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        parser.exit(1, f"Animation compilation failed: {error}\n")
    print(json.dumps({"clip": str(args.output.resolve() / "clip.json"), "frames": len(result["layers"][0]["frames"]),
                      "layers": len(result["layers"]), "canvas": result["canvas"], "qa": result["qa"]}, indent=2))


if __name__ == "__main__":
    main()
