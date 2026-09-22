import sys
import unittest
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from compile_character_motion import clean_components, compile_motion, uniform_corner_key, key_uniform_background, key_pruna_background, key_paint_background, refine_paint_alpha, despill_magenta_edges, key_magenta_islands
from PIL import Image


class MotionComponentsTest(unittest.TestCase):
    def test_opt_in_magenta_island_key_preserves_teal_and_amber(self):
        pixels=np.zeros((20,20,4),dtype=np.uint8)
        pixels[2:18,2:18]=[20,40,70,255]
        pixels[5:11,5:11]=[205,20,208,255]
        pixels[11,5]=[70,19,71,255]
        pixels[12,8]=[10,180,175,255]
        pixels[12,9]=[220,165,35,255]
        keyed=key_magenta_islands(Image.fromarray(pixels))
        self.assertEqual(keyed.getpixel((7,7))[3],0)
        self.assertEqual(keyed.getpixel((5,11))[3],0)
        self.assertEqual(keyed.getpixel((8,12))[3],255)
        self.assertEqual(keyed.getpixel((9,12))[3],255)

    def test_pruna_pixel_despill_removes_exposed_pink_fringe_only(self):
        pixels=np.zeros((16,16,4),dtype=np.uint8)
        pixels[3:13,3:13]=[20,40,70,255]
        pixels[3,4:12]=[110,17,94,255]
        pixels[7,7]=[110,17,94,255]
        pixels[8,8]=[240,140,35,255]
        result=np.asarray(despill_magenta_edges(Image.fromarray(pixels)))
        self.assertEqual(result[3,7,3],0)
        self.assertEqual(result[7,7,3],255)
        self.assertEqual(result[8,8,3],255)

    def test_local_refinement_preserves_needle_lavender_and_pale_interior(self):
        pixels=np.full((70,70,3),255,dtype=np.uint8)
        pixels[15:25,15:25]=[155,112,180]
        pixels[35:55,35]=[110,110,110]  # one-pixel needle, not a fat core
        pixels[40:55,45:60]=[180,180,180]  # intentional pale paint interior
        pixels[14,15:25]=[205,183,217]  # background-mixed lavender edge
        base=np.asarray(key_paint_background(Image.fromarray(pixels),True))
        result=np.asarray(key_paint_background(Image.fromarray(pixels),True,True))
        for y,x in [(20,20),(45,35),(47,52)]:
            self.assertTrue(np.array_equal(base[y,x],result[y,x]))
        self.assertTrue(np.array_equal(base[:,:,3]>0,result[:,:,3]>0))
        self.assertLess(result[14,20,3],base[14,20,3])
        self.assertEqual(result[0,0,3],0)

    def test_local_refinement_rejects_incompatible_color_and_empty_seed(self):
        rgb=np.full((10,10,3),255.,dtype=float); alpha=np.zeros((10,10))
        rgb[4,4]=[60,30,30]; alpha[4,4]=1
        rgb[4,5]=[210,230,150]; alpha[4,5]=.8
        result=refine_paint_alpha(rgb,np.array([255,255,255]),alpha)
        self.assertEqual(result[4,5],alpha[4,5])
        self.assertTrue(np.array_equal(refine_paint_alpha(rgb,np.array([255,255,255]),np.zeros((10,10))),np.zeros((10,10))))

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
    def test_per_frame_key_handles_pruna_magenta_white_flicker_without_erasing_actor(self):
        for background in [(255, 0, 255), (255, 255, 255)]:
            image=Image.new('RGB',(64,64),background)
            pixels=np.asarray(image).copy()
            pixels[18:48,20:44]=[15,35,60]
            keyed=key_uniform_background(Image.fromarray(pixels))
            self.assertEqual(keyed.getpixel((0,0))[3],0)
            self.assertEqual(keyed.getpixel((30,30))[3],255)
    def test_pruna_key_removes_large_enclosed_background_but_keeps_small_highlight(self):
        for background in [(255, 0, 255), (255, 255, 255)]:
            pixels=np.full((64,64,3),background,dtype=np.uint8)
            pixels[12:52,12:52]=[15,35,60]
            pixels[20:35,20:35]=background  # trapped gap between dark ribbons
            pixels[40:43,40:43]=background  # small intentional highlight
            keyed=key_pruna_background(Image.fromarray(pixels))
            self.assertEqual(keyed.getpixel((0,0))[3],0)
            self.assertEqual(keyed.getpixel((25,25))[3],0)
            self.assertEqual(keyed.getpixel((41,41))[3],255)
            self.assertEqual(keyed.getpixel((15,15))[3],255)
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
