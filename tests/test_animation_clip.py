import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from compile_animation_clip import compile_clip, key_background, select_frames, shared_palette


class ClipCompilerTests(unittest.TestCase):
    def fixture(self, directory, heights=(10, 20, 30), moving=False):
        paths, roots = [], []
        for i, height in enumerate(heights):
            im = Image.new("RGBA", (100, 100))
            x = 30 + i * 10 if moving else 50
            ImageDraw.Draw(im).rectangle((x-3, 80-height, x+3, 79), fill="#55ddbb")
            path = directory / f"{i}.png"
            im.save(path)
            paths.append(str(path))
            roots.append({"x":x,"y":80})
        return {"id":"test", "rootMode":"extract" if moving else "in-place", "intent":{"scaleChanges":True},
                "selection":[{"frame":i,"durationTicks":i+1} for i in range(len(paths))],
                "layers":[{"id":"body","source":{"frames":paths,"anchor":roots[0],"rootTrack":roots}}]}

    def test_growth_retained_common_canvas_and_timing(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            clip=compile_clip(self.fixture(root),root,root/"out")
            heights=[]
            for f in clip["layers"][0]["frames"]:
                with Image.open(root/"out"/f["file"]) as im:
                    bbox=im.getchannel("A").getbbox()
                    heights.append(bbox[3]-bbox[1])
                    self.assertEqual(im.size,(clip["canvas"]["width"],clip["canvas"]["height"]))
            self.assertEqual(heights,[10,20,30])
            self.assertEqual(clip["totalTicks"],6)
            self.assertEqual(clip["qa"]["status"],"needs-review")

    def test_root_extraction_stabilizes_body_and_preserves_displacement(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            clip=compile_clip(self.fixture(root,(10,10,10),True),root,root/"out")
            frames=clip["layers"][0]["frames"]
            self.assertEqual([f["rootMotion"]["x"] for f in frames],[0,10,20])
            pixels=[Image.open(root/"out"/f["file"]).tobytes() for f in frames]
            self.assertTrue(all(p==pixels[0] for p in pixels))

    def test_connected_key_preserves_internal_color_and_disconnected_parts(self):
        im=Image.new("RGBA",(40,40),"#ff00ff")
        d=ImageDraw.Draw(im)
        d.rectangle((8,8,25,25),fill="#112233")
        d.rectangle((13,13,17,17),fill="#ff00ff")
        d.rectangle((31,31,33,33),fill="#55ffaa")
        keyed=key_background(im,"#ff00ff")
        self.assertEqual(keyed.getpixel((0,0))[3],0)
        self.assertEqual(keyed.getpixel((15,15))[3],255)
        self.assertEqual(keyed.getpixel((32,32))[3],255)

    def test_required_contact_marker_survives_sampling_and_exports_event(self):
        images=[Image.new("RGBA",(20,20),(i*10,0,0,255)) for i in range(10)]
        selected=select_frames(images,{"frameCount":4,"markers":[{"frame":7,"durationTicks":9,"event":"impact"}]})
        self.assertEqual(next(f for f in selected if f["frame"]==7)["durationTicks"],9)
        self.assertEqual(selected[0]["frame"],0)
        self.assertEqual(selected[-1]["frame"],9)

    def test_layers_do_not_fit_separately_and_empty_vfx_frames_are_valid(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            spec=self.fixture(root)
            effect=Image.new("RGBA",(100,100))
            ImageDraw.Draw(effect).rectangle((5,45,95,55),fill="#aaffff")
            effect.save(root/"fx.png")
            spec["layers"].append({"id":"beam","role":"projectile","source":{"frames":[str(root/"fx.png")],"anchor":{"x":50,"y":80}}})
            clip=compile_clip(spec,root,root/"out")
            self.assertEqual(len(clip["layers"]),2)
            self.assertEqual(len(clip["layers"][1]["frames"]),3)
            self.assertGreater(clip["canvas"]["width"],90)
            im=Image.open(root/"out"/clip["layers"][0]["frames"][0]["file"])
            bbox=im.getchannel("A").getbbox()
            self.assertEqual(bbox[3]-bbox[1],10)

    def test_refuses_overwrite_and_invalid_events_without_partial_publish(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            spec=self.fixture(root)
            spec["events"]=[{"tick":6,"type":"late"}]
            with self.assertRaises(ValueError): compile_clip(spec,root,root/"out")
            self.assertFalse((root/"out").exists())
            spec["events"]=[]
            compile_clip(spec,root,root/"out")
            with self.assertRaises(ValueError): compile_clip(spec,root,root/"out")

    def test_explicit_palette_preserves_alpha_and_runtime_timing(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            spec=self.fixture(root)
            spec["palette"]=["#000000","#ffffff","#00ff00"]
            clip=compile_clip(spec,root,root/"out")
            with Image.open(root/"out"/clip["layers"][0]["frames"][0]["file"]) as im:
                colors={p[:3] for p in im.getdata() if p[3]}
                self.assertTrue(colors <= {(0,0,0),(255,255,255),(0,255,0)})
                self.assertEqual(im.getpixel((0,0))[3],0)
            fragment=json.loads((root/"out/runtime-fragment.json").read_text())
            self.assertEqual(fragment["visualTimeline"],[{"frame":0,"duration":1},{"frame":1,"duration":2},{"frame":2,"duration":3}])

    def test_translucent_aura_can_define_a_palette(self):
        palette, colors=shared_palette([Image.new("RGBA",(8,8),(120,90,255,100))],count=4)
        self.assertEqual(len(colors),4)

    def test_timebase_mismatch_is_rejected_before_publishing(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            spec=self.fixture(root)
            spec["tickRate"]=30
            with self.assertRaisesRegex(ValueError,"gameplay timebase"):
                compile_clip(spec,root,root/"out")
            self.assertFalse((root/"out").exists())


if __name__=="__main__": unittest.main()
