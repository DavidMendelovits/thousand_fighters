import sys
import unittest
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from compile_character_motion import clean_components, compile_motion, uniform_corner_key, key_uniform_background, key_paint_background
from PIL import Image


class MotionComponentsTest(unittest.TestCase):
    def test_matte_cleanup_preserves_alpha_opaque_lavender_and_grey_needle(self):
        pixels=np.full((60,60,3),255,dtype=np.uint8)
        pixels[15:25,15:25]=[155,112,180]
        pixels[35:45,35:45]=[110,110,110]
        pixels[14,15:25]=[220,195,220]
        original=np.asarray(key_paint_background(Image.fromarray(pixels)))
        clean=np.asarray(key_paint_background(Image.fromarray(pixels),True))
        self.assertTrue(np.array_equal(original[:,:,3],clean[:,:,3]))
        self.assertTrue(np.array_equal(original[20,20],clean[20,20]))
        self.assertTrue(np.array_equal(original[40,40],clean[40,40]))
        self.assertTrue(np.all(clean[14,20,:3]<original[14,20,:3]))
        self.assertEqual(clean[0,0,3],0)

    def test_paint_key_preserves_lavender_and_both_detached_hands(self):
        im=Image.new('RGB',(60,60),(255,0,255));p=np.asarray(im).copy()
        p[15:25,15:25]=[155,112,180];p[35:45,35:45]=[215,140,50]
        result=key_paint_background(Image.fromarray(p))
        self.assertEqual(result.getpixel((0,0))[3],0)
        self.assertEqual(result.getpixel((20,20))[3],255)
        self.assertEqual(result.getpixel((40,40))[3],255)
    def test_uniform_key_preserves_enclosed_costume_color(self):
        im=Image.new('RGB',(40,40),(240,30,90))
        pixels=np.asarray(im).copy();pixels[10:30,10:30]=[20,40,70];pixels[15:20,15:20]=[240,30,90]
        keyed=key_uniform_background(Image.fromarray(pixels))
        self.assertEqual(keyed.getpixel((0,0))[3],0)
        self.assertEqual(keyed.getpixel((16,16))[3],255)
        pixels[0:8,0:8]=[0,255,0]
        with self.assertRaises(ValueError):uniform_corner_key(Image.fromarray(pixels))
    def test_default_keeps_detached_props(self):
        alpha = np.zeros((50, 50), dtype=np.uint8)
        alpha[10:40, 10:30] = 255
        alpha[2:8, 40:46] = 200
        self.assertTrue(np.array_equal(alpha, clean_components(alpha)))

    def test_body_only_removes_detached_effect_not_connected_hand(self):
        alpha = np.zeros((50, 50), dtype=np.uint8)
        alpha[10:40, 10:30] = 255
        alpha[15:18, 30:39] = 210
        alpha[2:8, 40:46] = 200
        cleaned = clean_components(alpha, 'largest')
        self.assertEqual(cleaned[16, 38], 210)
        self.assertEqual(cleaned[3, 41], 0)
        self.assertEqual(alpha[3, 41], 200)

    def test_empty_mask_and_invalid_mode(self):
        alpha = np.zeros((10, 10), dtype=np.uint8)
        self.assertFalse(clean_components(alpha, 'largest').any())
        with self.assertRaises(ValueError):
            clean_components(alpha, 'unknown')

    def test_ping_pong_cannot_silently_reverse_a_one_shot(self):
        with self.assertRaisesRegex(ValueError, 'explicit loop'):
            compile_motion('unused', 'unused', 'unused', 'kick', ping_pong=True)


if __name__ == '__main__':
    unittest.main()
