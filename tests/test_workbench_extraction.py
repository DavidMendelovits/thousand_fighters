import importlib.util
import tempfile
import unittest
from pathlib import Path
from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location('extract', Path(__file__).parents[1] / 'scripts/extract_row_frames.py')
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)


class VideoRowExtractionTests(unittest.TestCase):
    def test_connected_spill_removed_without_erasing_purple_interior(self):
        pixels = [(255, 0, 255, 255), (120, 12, 124, 255), (100, 55, 175, 255), (0, 0, 0, 0)]
        self.assertEqual(extract.foreground_mask(pixels, 4, 1, True), [False, False, True, False])

    def test_video_uses_reference_pivot_and_global_scale_for_extension(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.png'
            sheet = Image.new('RGBA', (200, 100), (255, 0, 255, 255))
            draw = ImageDraw.Draw(sheet)
            draw.rectangle((30, 50, 49, 79), fill=(80, 90, 140, 255))
            draw.rectangle((130, 50, 149, 79), fill=(80, 90, 140, 255))
            draw.rectangle((145, 20, 180, 54), fill=(80, 90, 140, 255))
            sheet.save(source)
            report = extract.extract_frames(source, Path(directory) / 'frames', move_id='punch', rows=1, cols=2,
                                     target_height=30, equalize_frames=False, video_source=True)
            first, extended = report['frameData']
            self.assertEqual(report['scaleApplied'], 1)
            self.assertEqual(first['anchor']['x'], extended['anchor']['x'])
            self.assertEqual(extended['anchor']['y'] - first['anchor']['y'], 30)
            self.assertEqual(extended['silhouetteHeight'], 60)


if __name__ == '__main__':
    unittest.main()
