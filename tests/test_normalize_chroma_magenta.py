import sys
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from normalize_chroma_magenta import normalize


class NormalizeChromaMagentaTests(unittest.TestCase):
    def test_edge_connected_uneven_pink_is_normalized_without_hollowing_subject(self):
        image = Image.new("RGBA", (32, 32), (232, 124, 243, 255))
        for x in range(8, 24):
            for y in range(8, 24):
                image.putpixel((x, y), (15, 40, 61, 255))
        image.putpixel((16, 16), (245, 0, 250, 255))
        result = normalize(image)
        self.assertEqual(result.getpixel((0, 0)), (255, 0, 255, 255))
        self.assertEqual(result.getpixel((16, 16)), (245, 0, 250, 255))

    def test_non_chroma_scene_is_not_recolored(self):
        image = Image.new("RGBA", (32, 32), (25, 40, 80, 255))
        self.assertEqual(normalize(image).getpixel((0, 0)), (25, 40, 80, 255))

    def test_dark_rose_magenta_field_is_normalized(self):
        image = Image.new("RGBA", (32, 32), (184, 61, 128, 255))
        self.assertEqual(normalize(image).getpixel((0, 0)), (255, 0, 255, 255))


if __name__ == "__main__":
    unittest.main()
