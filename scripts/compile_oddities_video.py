#!/usr/bin/env python3
"""Compile reviewed signature videos; preserve the original poses and provenance."""
import json
import subprocess
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
JOBS={'brine':'brine-reel-v1','meridian':'meridian-cast-v1','taffy':'taffy-stretch-v1',
      'vesper':'vesper-cast-v1','vellum':'vellum-bind-v1','kiln':'kiln-slam-v1',
      'mycel':'mycel-roots-v1','rook':'rook-magnet-v1','veil':'veil-snare-v1','bellwether':'bellwether-wave-v1'}
for fighter,job in JOBS.items():
    directory=ROOT/'artifacts/animation-video/oddities'/job
    out=ROOT/'public/fighters'/fighter/'video-signature'
    if out.exists():
        print(f'{fighter}: retained existing compilation')
        continue
    # Source movie is 960x960; reference is 512x512. Feet are the reference's
    # bottom opaque band. One scale/pivot for the entire sequence, no pose fitting.
    ref=Image.open(directory.parent/f'{fighter}-reference.png').convert('RGB')
    coords=[(x,y) for y in range(ref.height) for x in range(ref.width) if not (ref.getpixel((x,y))[0]>180 and ref.getpixel((x,y))[2]>180 and ref.getpixel((x,y))[1]<90)]
    bottom=max(y for x,y in coords)
    feet=[x for x,y in coords if y>=bottom-3]
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',str(directory/'source.mp4')]))['streams'][0]
    factor=probe['width']/512
    anchor={'x':round((min(feet)+max(feet))/2*factor),'y':round((bottom+1)*factor)}
    scale=1/(2*factor)
    if fighter=='meridian':
        selections=[(0,4),(24,4),(42,4),(50,4),(54,3),(60,3),(70,6),(84,6),(100,6),(120,8)]
    elif fighter=='kiln':
        selections=[(0,4),(24,4),(48,5),(60,5),(68,4),(76,4),(84,6),(96,6),(108,6),(120,8)]
    elif fighter=='veil':
        # Reject the middle section whose rear sleeve leaves the source canvas.
        # The selected anticipation/retraction stays whole; engine owns reach.
        selections=[(0,4),(8,4),(16,4),(24,4),(28,4),(32,4),(36,4),(40,4),(44,4),(48,6),(104,6),(110,8),(116,8),(120,8)]
    elif fighter in ('vesper','vellum','mycel','rook','bellwether'):
        selections=[(0,4),(12,4),(24,4),(42,4),(60,3),(72,3),(84,6),(96,6),(108,6),(120,8)]
    else:
        selections=[(0,4),(24,4),(48,4),(52,4),(56,4),(64,4),(72,4),(80,4),(88,4),(96,6),(100,6),(104,8),(112,8),(120,8)]
    spec={'id':f'{fighter}_signature','displayName':f'{fighter.title()} · video signature','kind':'attack','playback':'once','tickRate':60,'scale':scale,'padding':6,'paletteSize':48,'rootMode':'baked',
      'intent':{'topologyChanges':False,'scaleChanges':False,'paletteChanges':False},
      'provenance':{'method':'generated-video','provider':'fal','model':'kling-video/v3/standard/image-to-video','description':'Reviewed video-derived body motion. Fixed reference-foot anchor and scale; authored action timing. Long-range attached extension and collisions remain engine-driven. Prototype, not final sprite cleanup.'},
      'layers':[{'id':'body','role':'body','z':0,'source':{'video':'source.mp4','fps':24,'anchor':anchor,'background':'#ff00ff','backgroundMode':'chroma'}}],
      'selection':[{'frame':f,'durationTicks':d} for f,d in selections]}
    spec['selection'][3 if fighter in ('brine','taffy','veil') else 4]['event']={'type':'activate','label':'Cast / extension begins'}
    file=directory/'compile.json';file.write_text(json.dumps(spec,indent=2)+'\n')
    subprocess.run(['python3',str(ROOT/'scripts/compile_animation_clip.py'),str(file),'--output',str(out)],check=True)
