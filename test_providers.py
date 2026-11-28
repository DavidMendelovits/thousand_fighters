"""Offline checks for providers.py and the bake-off plumbing: python3 -m unittest test_providers"""
import os, tempfile, unittest
import numpy as np
from PIL import Image, ImageDraw

import providers as p


class Normalize(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()

    def img(self, size, bg, name='x.png'):
        im = Image.new('RGB', size, bg); g = ImageDraw.Draw(im)
        g.rectangle([size[0] * .4, size[1] * .2, size[0] * .6, size[1] * .9], fill=(30, 90, 80), outline=(10, 10, 10), width=3)
        path = os.path.join(self.d, name); im.save(path); return path

    def test_nearest_size(self):
        self.assertEqual(p.nearest_size('1536x1024', ['1:1', '3:2', '16:9']), '3:2')
        self.assertEqual(p.nearest_size('1024x1024', ['1024x1024', '1536x1024']), '1024x1024')
        self.assertEqual(p.nearest_size('1536x1024', ['1024x1024', '1536x1024', '1024x1536']), '1536x1024')

    def test_white_backdrop_turns_magenta_and_size_is_restored(self):
        path = self.img((832, 832), (250, 250, 250))
        info = p.normalize(path, '1024x1024', 'auto')
        im = np.array(Image.open(path).convert('RGB'))
        self.assertEqual(im.shape[:2], (1024, 1024))
        self.assertEqual(tuple(im[5, 5]), (255, 0, 255))      # backdrop
        self.assertEqual(tuple(im[600, 512]), (30, 90, 80))   # figure kept
        self.assertEqual(info['backdrop_keyed'], [250, 250, 250])
        self.assertNotIn('stretched', info)

    def test_magenta_backdrop_untouched(self):
        path = self.img((1024, 1024), (255, 0, 255))
        self.assertEqual(p.normalize(path, '1024x1024', 'auto'), {})

    def test_wrong_aspect_is_stretched_and_logged(self):
        path = self.img((832, 832), (255, 0, 255))
        info = p.normalize(path, '1536x1024', 'auto')
        self.assertTrue(info['stretched']); self.assertEqual(Image.open(path).size, (1536, 1024))

    def test_figure_wearing_backdrop_colour_keeps_it(self):
        path = self.img((512, 512), (250, 250, 250))
        im = Image.open(path); ImageDraw.Draw(im).rectangle([240, 300, 270, 330], fill=(250, 250, 250)); im.save(path)  # white patch inside the figure
        p.normalize(path, '512x512', 'auto')
        self.assertEqual(tuple(np.array(Image.open(path).convert('RGB'))[315, 255]), (250, 250, 250))


class Resolve(unittest.TestCase):
    def test_table_names(self):
        for name in p.load_models():
            m = p.resolve(name)
            self.assertIn(m.provider, p.ADAPTERS); self.assertGreaterEqual(m.max_refs, 2, name)

    def test_provider_prefix(self):
        m = p.resolve('fal:fal-ai/nano-banana-pro/edit')
        self.assertEqual((m.provider, m.id, m.label), ('fal', 'fal-ai/nano-banana-pro/edit', 'fal:fal-ai/nano-banana-pro/edit'))

    def test_bare_name_without_key_is_codex(self):
        old = os.environ.pop('OPENAI_API_KEY', None)
        try: self.assertEqual(p.resolve('some-openai-model').provider, 'codex')
        finally:
            if old: os.environ['OPENAI_API_KEY'] = old

    def test_fixture_paints_without_a_key(self):
        d = tempfile.mkdtemp(); guide = os.path.join(d, 'g.png'); out = os.path.join(d, 'o.png')
        Image.new('RGB', (1024, 1024), (255, 0, 255)).save(guide)
        info = p.resolve('fixture-offsize').paint('x', [guide, guide], out, '1024x1024')
        self.assertEqual(Image.open(out).size, (1024, 1024)); self.assertEqual(info['got_size'], '832x832')


if __name__ == '__main__': unittest.main()
