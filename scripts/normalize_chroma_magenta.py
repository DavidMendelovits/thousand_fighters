#!/usr/bin/env python3
"""Normalize only an edge-connected near-magenta field for sprite extraction.

The existing strict corner check still rejects images without a chroma field.
Interior magenta details are left untouched so a character cannot be hollowed.
"""

import argparse
from collections import deque
from pathlib import Path

from PIL import Image


def is_field(pixel):
    r, g, b, a = pixel
    # Flux sometimes darkens #ff00ff into rose-magenta (observed corners
    # around 184, 61, 128). Edge connectivity is the safety boundary.
    return a == 0 or (r >= 155 and b >= 110 and g <= 165 and r - g >= 60 and b - g >= 50)


def normalize(image):
    result = image.convert("RGBA")
    width, height = result.size
    pixels = result.load()
    stride_x = max(1, width // 64)
    stride_y = max(1, height // 64)
    corners = [(x, y) for x in range(0, width, stride_x) for y in range(0, height, stride_y)
               if (x < width // 8 or x >= width * 7 // 8)
               and (y < height // 8 or y >= height * 7 // 8)]
    if not corners or sum(is_field(pixels[x, y]) for x, y in corners) / len(corners) < 0.75:
        return result
    seen = bytearray(width * height)
    queue = deque()
    for x in range(width):
        queue.append((x, 0))
        queue.append((x, height - 1))
    for y in range(height):
        queue.append((0, y))
        queue.append((width - 1, y))
    while queue:
        x, y = queue.popleft()
        index = y * width + x
        if seen[index] or not is_field(pixels[x, y]):
            continue
        seen[index] = 1
        pixels[x, y] = (255, 0, 255, 255)
        if x:
            queue.append((x - 1, y))
        if x + 1 < width:
            queue.append((x + 1, y))
        if y:
            queue.append((x, y - 1))
        if y + 1 < height:
            queue.append((x, y + 1))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    normalize(Image.open(args.input)).save(args.output, format="PNG")


if __name__ == "__main__":
    main()
