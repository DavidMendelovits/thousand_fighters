import sys
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from normalize_projectile import chroma_key, despill_edges


class ProjectileKeyTests(unittest.TestCase):
    def test_tinted_uniform_magenta_keys_exterior_and_enclosed_background(self):
        image = Image.new("RGB", (96, 96), (183, 29, 233))
        draw = ImageDraw.Draw(image)
        draw.ellipse((20, 20, 76, 76), fill=(10, 25, 45))
        draw.ellipse((39, 39, 57, 57), fill=(183, 29, 233))
        keyed = chroma_key(image)
        self.assertEqual(keyed.getpixel((0, 0))[3], 0)
        self.assertEqual(keyed.getpixel((48, 48))[3], 0)
        self.assertEqual(keyed.getpixel((30, 48))[3], 255)
        self.assertEqual(despill_edges(keyed).getpixel((0, 0))[3], 0)

    def test_nonuniform_or_nonmagenta_corners_fail_closed(self):
        image = Image.new("RGB", (64, 64), "white")
        with self.assertRaisesRegex(ValueError, "uniform magenta"):
            chroma_key(image)
        image = Image.new("RGB", (64, 64), (183, 29, 233))
        image.putpixel((0, 0), (20, 150, 20))
        with self.assertRaisesRegex(ValueError, "uniform magenta"):
            chroma_key(image)

    def test_already_transparent_source_is_retained(self):
        image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        ImageDraw.Draw(image).ellipse((20, 20, 44, 44), fill=(10, 25, 45, 255))
        keyed = chroma_key(image)
        self.assertEqual(keyed.getpixel((0, 0))[3], 0)
        self.assertEqual(keyed.getpixel((32, 32))[3], 255)


if __name__ == "__main__":
    unittest.main()
