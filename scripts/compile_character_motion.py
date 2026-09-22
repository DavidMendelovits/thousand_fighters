"""Video -> variable-count actor row. Candidates require explicit visual approval.

No per-frame fitting; one scale measured from the reference/start pose. Root
translation is removed horizontally, but pose height and body deformation remain.
"""
import argparse
import hashlib
import json
import subprocess
import tempfile
import platform
import PIL
import scipy
from pathlib import Path
import numpy as np
from scipy import ndimage
from PIL import Image, ImageDraw
from compile_animation_clip import key_background, shared_palette


def clean_components(alpha, component_mode='all'):
    if component_mode not in ('all', 'largest'):
        raise ValueError('Unknown component mode')
    alpha = alpha.copy()
    labels, _ = ndimage.label(alpha > 0)
    sizes = np.bincount(labels.ravel())
    alpha[sizes[labels] < 20] = 0
    if component_mode == 'largest' and len(sizes) > 1:
        actor_label = 1 + int(np.argmax(sizes[1:]))
        alpha[labels != actor_label] = 0
    return alpha


def uniform_corner_key(im):
    rgb=np.asarray(im.convert('RGB')).astype(float)
    corners=np.concatenate([rgb[:8,:8].reshape(-1,3),rgb[:8,-8:].reshape(-1,3),rgb[-8:,:8].reshape(-1,3),rgb[-8:,-8:].reshape(-1,3)])
    color=np.median(corners,axis=0)
    if np.max(np.abs(corners-color))>24:
        raise ValueError('Non-uniform source corners: automatic key would be unsafe')
    return '#'+''.join(f'{round(c):02x}' for c in color)


def key_uniform_background(im):
    color=uniform_corner_key(im)
    image=im.convert('RGBA')
    pixels=np.asarray(image).copy()
    rgb=np.array([int(color[i:i+2],16) for i in (1,3,5)])
    candidates=np.max(np.abs(pixels[:,:,:3].astype(int)-rgb),axis=2)<=64
    border=np.zeros(candidates.shape,dtype=bool)
    border[0,:]=border[-1,:]=True; border[:,0]=border[:,-1]=True
    exterior=ndimage.binary_propagation(border & candidates,mask=candidates)
    pixels[exterior,3]=0
    return Image.fromarray(pixels)


def key_pruna_background(im):
    """Key a uniform per-frame backdrop, including large enclosed gaps.

    Pruna sometimes switches its nominal magenta key to white mid-video.
    Exterior-only flood fill leaves background trapped inside orbiting ribbons;
    key large same-color islands too, retaining tiny enclosed highlights.
    """
    color=uniform_corner_key(im)
    pixels=np.asarray(im.convert('RGBA')).copy()
    rgb=np.array([int(color[i:i+2],16) for i in (1,3,5)])
    candidates=np.max(np.abs(pixels[:,:,:3].astype(int)-rgb),axis=2)<=64
    border=np.zeros(candidates.shape,dtype=bool)
    border[0,:]=border[-1,:]=True; border[:,0]=border[:,-1]=True
    exterior=ndimage.binary_propagation(border & candidates,mask=candidates)
    labels,_=ndimage.label(candidates)
    sizes=np.bincount(labels.ravel())
    enclosed_large=candidates & (sizes[labels]>=80)
    pixels[exterior | enclosed_large,3]=0
    return Image.fromarray(pixels)


def key_magenta_distance(im):
    """Remove the actual key, not every purple pigment in the character."""
    pixels=np.asarray(im.convert('RGBA')).copy()
    rgb=pixels[:,:,:3].astype(float)
    pixels[np.linalg.norm(rgb-np.array([255,0,255]),axis=2)<115,3]=0
    return Image.fromarray(pixels)

def despill_magenta_edges(im):
    """Remove residual pink compression fringe only at exposed silhouette edges."""
    pixels=np.asarray(im.convert('RGBA')).copy()
    opaque=pixels[:,:,3]>0
    edge=opaque&(ndimage.distance_transform_edt(opaque)<=3)
    rgb=pixels[:,:,:3].astype(float)
    fringe=edge&(rgb[:,:,0]>70)&(rgb[:,:,2]>70)&(rgb[:,:,0]>rgb[:,:,1]*1.5)&(rgb[:,:,2]>rgb[:,:,1]*1.5)
    pixels[fringe,3]=0
    return Image.fromarray(pixels)

def key_magenta_islands(im):
    """Opt-in removal of saturated chroma islands on white-key frames.

    Only use when the character palette excludes magenta; this would erase
    deliberately pink costume or VFX pixels. Other key modes remain unchanged.
    """
    pixels=np.asarray(im.convert('RGBA')).copy()
    rgb=pixels[:,:,:3].astype(int)
    chroma=(rgb[:,:,0]>=60)&(rgb[:,:,2]>=60)&(rgb[:,:,1]<=100)&((rgb[:,:,0]-rgb[:,:,1])>=35)&((rgb[:,:,2]-rgb[:,:,1])>=35)
    pixels[chroma,3]=0
    return Image.fromarray(pixels)

def refine_paint_alpha(rgb, key, alpha):
    """Conservative local color-line matte; preserve opaque cores and thin dark props.

    Only revise a near-boundary pixel when a nearby foreground color explains
    it as a mixture with the known flat backdrop. Non-collinear colors stay put.
    """
    distance=np.linalg.norm(rgb-key,axis=2)
    interior=ndimage.distance_transform_edt(alpha>0)
    seeds=(alpha>=.98)&((distance>=150)|(interior>=3))
    if not np.any(seeds):
        return alpha
    proximity,indices=ndimage.distance_transform_edt(~seeds,return_indices=True)
    foreground=rgb[indices[0],indices[1]]
    direction=foreground-key
    estimate=np.clip(np.sum((rgb-key)*direction,axis=2)/np.maximum(1,np.sum(direction*direction,axis=2)),0,1)
    residual=np.linalg.norm(rgb-(key+estimate[:,:,None]*direction),axis=2)
    compatible=(alpha>0)&~seeds&(proximity<=4)&(residual<=20)
    result=alpha.copy()
    result[compatible]=np.minimum(alpha[compatible],np.maximum(1/255,estimate[compatible]))
    return result


def key_paint_background(im, matte_cleanup=False, refine_edges=False):
    """Flat per-frame key with a soft transition; preserve low-saturation lavender."""
    color=uniform_corner_key(im)
    pixels=np.asarray(im.convert('RGBA')).copy()
    key=np.array([int(color[i:i+2],16) for i in (1,3,5)])
    distance=np.linalg.norm(pixels[:,:,:3].astype(float)-key,axis=2)
    alpha=np.clip((distance-65)/45,0,1)
    if refine_edges:
        alpha=refine_paint_alpha(pixels[:,:,:3].astype(float),key,alpha)
    if matte_cleanup or refine_edges:
        # Undo the flat-background contribution in partial-coverage pixels.
        # Do not erode the silhouette or recolor opaque lavender / grey props.
        foreground=(pixels[:,:,:3].astype(float)-(1-alpha[:,:,None])*key)/np.maximum(alpha[:,:,None],1/255)
        edge=(alpha>0)&(alpha<1)
        pixels[edge,:3]=np.clip(np.rint(foreground[edge]),0,255).astype(np.uint8)
    pixels[:,:,3]=(pixels[:,:,3]*alpha).astype(np.uint8)
    return Image.fromarray(pixels)


def compile_motion(video, reference, output, action, count=20, loop=False, start=None, end=None, style='pixel', component_mode='all', ping_pong=False, background='magenta', root_mode='pelvis', expand_canvas=False, matte_cleanup=False, refine_edges=False, despill_magenta=False, key_magenta_gaps=False):
    if ping_pong and not loop:
        raise ValueError('Ping-pong playback requires an explicit loop')
    if (matte_cleanup or refine_edges) and background!='paint-auto':
        raise ValueError('Paint matte cleanup requires the paint-auto background key')
    if not 8 <= count <= 48:
        raise ValueError('Choose 8–48 output frames')
    output = Path(output)
    if output.exists():
        raise ValueError('Candidate exists; use a new output version, never overwrite an accepted row')
    with tempfile.TemporaryDirectory(prefix='tf-motion-') as temp:
        subprocess.run(['ffmpeg','-v','error','-i',str(video),'-vf','scale=512:512:force_original_aspect_ratio=decrease:flags=neighbor','-vsync','0',f'{temp}/%04d.png'],check=True)
        paths=sorted(Path(temp).glob('*.png'))
        if not 8 <= len(paths) <= 360:
            raise ValueError('Expected 8–360 source frames')
        first_index=0 if start is None else start
        last_index=len(paths)-1 if end is None else end
        if not 0 <= first_index < last_index < len(paths) or last_index-first_index+(0 if loop else 1) < count:
            raise ValueError('Selected source range must contain at least the requested number of output frames')
        images=[]
        for path in paths:
            source=Image.open(path)
            im=key_paint_background(source,matte_cleanup,refine_edges) if background=='paint-auto' else key_pruna_background(source) if background=='pruna-frame' else key_uniform_background(source) if background=='auto-frame' else key_magenta_distance(source) if background=='magenta-distance' else key_background(source,'#ff00ff',mode='chroma')
            if key_magenta_gaps: im=key_magenta_islands(im)
            alpha=np.array(im.getchannel('A'))
            # Explicit body-only cleanup: detached sparks are separate VFX, never
            # silently discard disconnected props in the default import path.
            alpha = clean_components(alpha, component_mode)
            im.putalpha(Image.fromarray(alpha))
            if despill_magenta: im=despill_magenta_edges(im)
            images.append(im)
    ref=Image.open(reference).convert('RGBA')
    ref_box=ref.getbbox()
    first=images[0].getbbox()
    if not first: raise ValueError('Empty keyed source')
    scale=(ref_box[3]-ref_box[1])/(first[3]-first[1])
    floor=first[3]
    height=first[3]-first[1]
    # Pelvis strip excludes a reaching arm and feet crossing during a stride.
    roots=[]
    for im in images:
        strip=im.getchannel('A').crop((0,round(floor-height*.48),im.width,round(floor-height*.38))).getbbox()
        roots.append((strip[0]+strip[2])/2 if strip else (first[0]+first[2])/2)
    roots=ndimage.median_filter(roots,size=5)
    if root_mode=='fixed':
        roots=np.full(len(images),(first[0]+first[2])/2)
    size=ref.size
    anchor=(round(size[0]*96/224),round(size[1]*176/192)); normalized=[]; clipping=[]
    if expand_canvas:
        bounds=[]
        for im,root in zip(images,roots):
            b=im.getbbox()
            if b:bounds.append((anchor[0]+(b[0]-root)*scale,anchor[1]+(b[1]-floor)*scale,anchor[0]+(b[2]-root)*scale,anchor[1]+(b[3]-floor)*scale))
        left=max(0,int(np.ceil(10-min(b[0] for b in bounds))))
        top=max(0,int(np.ceil(10-min(b[1] for b in bounds))))
        right=max(0,int(np.ceil(max(b[2] for b in bounds)+10-size[0])))
        bottom=max(0,int(np.ceil(max(b[3] for b in bounds)+10-size[1])))
        size=(size[0]+left+right,size[1]+top+bottom)
        anchor=(anchor[0]+left,anchor[1]+top)
    for i,(im,root) in enumerate(zip(images,roots)):
        box=im.getbbox()
        if not box: raise ValueError(f'Empty source frame {i}')
        if min(box[0],box[1],im.width-box[2],im.height-box[3])<3: clipping.append(i)
        small=im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.LANCZOS if style=='watercolor' else Image.Resampling.NEAREST)
        x=anchor[0]-round(root*scale);y=anchor[1]-round(floor*scale)
        b=small.getbbox()
        if min(x+b[0],y+b[1],size[0]-x-b[2],size[1]-y-b[3])<4: clipping.append(i)
        frame=Image.new('RGBA',size);frame.alpha_composite(small,(x,y));normalized.append(frame)
    clipping=sorted({i for i in clipping if first_index<=i<=last_index})
    if clipping: raise ValueError(f'Source/canvas clipping at frames {clipping}; widen canvas or regenerate')
    # Compare normalized body/leg masks; no static-pose motion acceptance from
    # video compression noise, animated background or image translation alone.
    masks=np.array([np.array(im.getchannel('A'))>0 for im in normalized])
    region=masks[:,round(55*size[1]/192):round(177*size[1]/192),round(40*size[0]/224):round(180*size[0]/224)]
    selected_region=region[first_index:last_index+1]
    diversity=float(np.mean(np.any(selected_region,axis=0)!=np.all(selected_region,axis=0)))
    legs=selected_region[:,round(65*size[1]/192):]
    leg_diversity=float(np.mean(np.any(legs,axis=0)!=np.all(legs,axis=0)))
    if diversity<.015 or (root_mode=='pelvis' and action.startswith('walk') and leg_diversity<.04):
        raise ValueError(f'Insufficient articulated motion: body={diversity:.3f}, legs={leg_diversity:.3f}')
    seam=None
    if loop and start is None and end is None:
        # Find one complete moving cycle, not a short near-static tail.
        candidates=[]
        for a in range(5,max(6,len(images)-count)):
            for b in range(a+count,min(len(images),a+max(49,count+1))):
                motion=float(np.mean(np.any(region[a:b],axis=0)!=np.all(region[a:b],axis=0)))
                if motion < (.025 if action=='idle' else .08): continue
                union=np.logical_or(region[a],region[b]).sum()
                error=np.logical_xor(region[a],region[b]).sum()/max(1,union)
                candidates.append((error,a,b))
        if not candidates: raise ValueError('No non-static loop candidate; inspect the source')
        seam,first_index,last_index=min(candidates)
    if not 0 <= first_index < last_index < len(images):
        raise ValueError('Selected source range must contain at least two valid frames')
    if loop and seam is None:
        union=np.logical_or(region[first_index],region[last_index]).sum()
        seam=float(np.logical_xor(region[first_index],region[last_index]).sum()/max(1,union))
    indices=np.linspace(first_index,last_index,num=min(count,last_index-first_index+(0 if loop else 1)),endpoint=not loop).astype(int).tolist()
    if ping_pong:
        indices += indices[-2:0:-1]
        union=np.logical_or(region[indices[0]],region[indices[-1]]).sum()
        seam=float(np.logical_xor(region[indices[0]],region[indices[-1]]).sum()/max(1,union))
    selected=[normalized[i] for i in indices]
    if style!='watercolor':
        palette,_=shared_palette([ref],count=48)
        for i,im in enumerate(selected):
            alpha=im.getchannel('A');im=im.convert('RGB').quantize(palette=palette,dither=Image.Dither.NONE).convert('RGBA');im.putalpha(alpha);selected[i]=im
            if key_magenta_gaps: selected[i]=key_magenta_islands(selected[i])
    unique=len({hashlib.sha256(im.tobytes()).hexdigest() for im in selected})
    if unique<min(8,len(selected)):raise ValueError('Too few distinct motion frames')
    output.mkdir(parents=True)
    (output/'frames').mkdir()
    metadata=[];contact=Image.new('RGB',(size[0]*5,(size[1]+20)*((len(selected)+4)//5)),'#19212b')
    for i,im in enumerate(selected):
        file=f'frames/{action}_{i+1:03}.png';im.save(output/file)
        metadata.append({'file':file,'width':size[0],'height':size[1],'anchor':{'x':anchor[0],'y':anchor[1]},'durationFrames':3,'sourceFrame':indices[i]})
        x,y=(i%5)*size[0],(i//5)*(size[1]+20);contact.paste(im,(x,y),im);ImageDraw.Draw(contact).text((x+5,y+size[1]),f'{i}: source {indices[i]}',fill='white')
    contact.save(output/'contact.png')
    selected[0].save(output/'preview.png',save_all=True,append_images=selected[1:],duration=50,loop=0,disposal=0,blend=0)
    sheet=Image.new('RGBA',(size[0]*len(selected),size[1]))
    for i,im in enumerate(selected):sheet.alpha_composite(im,(i*size[0],0))
    sheet.save(output/'sheet.png')
    widths=[im.getbbox()[2] for im in selected]
    report={'schemaVersion':1,'action':action,'status':'needs-visual-review','source':str(video),'sourceSha256':hashlib.sha256(Path(video).read_bytes()).hexdigest(),'sourceFrameCount':len(images),'frameCount':len(selected),'uniqueFrames':unique,'scale':scale,'bodyMotion':diversity,'legMotion':leg_diversity,'loop':loop,'loopSeamError':seam,'sourceRange':[first_index,last_index],'rootTravelPixels':float(max(roots)-min(roots)),'suggestedContactFrame':int(np.argmax(widths)),'clippedFrames':[],'frames':metadata}
    report['provenance']={'compilerSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'keyerSha256':hashlib.sha256(Path(__file__).with_name('compile_animation_clip.py').read_bytes()).hexdigest(),'referenceSha256':hashlib.sha256(Path(reference).read_bytes()).hexdigest(),'options':{'action':action,'count':count,'loop':loop,'start':start,'end':end,'style':style},'environment':{'python':platform.python_version(),'numpy':np.__version__,'pillow':PIL.__version__,'scipy':scipy.__version__,'ffmpeg':subprocess.run(['ffmpeg','-version'],capture_output=True,text=True,check=True).stdout.splitlines()[0]}}
    report['provenance']['options']['componentMode'] = component_mode
    report['provenance']['options']['pingPong'] = ping_pong
    report['provenance']['options']['background'] = background
    report['provenance']['options']['rootMode'] = root_mode
    report['provenance']['options']['expandCanvas'] = expand_canvas
    report['provenance']['options']['matteCleanup'] = matte_cleanup
    report['provenance']['options']['refineEdges'] = refine_edges
    report['provenance']['options']['despillMagenta'] = despill_magenta
    report['provenance']['options']['keyMagentaGaps'] = key_magenta_gaps
    (output/'motion.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='frames'}))
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('video',type=Path);p.add_argument('--reference',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--action',required=True);p.add_argument('--frames',type=int,default=20);p.add_argument('--loop',action='store_true');p.add_argument('--start',type=int);p.add_argument('--end',type=int)
    p.add_argument('--style',choices=['pixel','watercolor'],default='pixel')
    p.add_argument('--component-mode',choices=['all','largest'],default='all',help='Use largest only for reviewed body-only sources without detached props')
    p.add_argument('--ping-pong',action='store_true',help='Explicit reversible breathing/sway loop; recorded in provenance, not for directional actions')
    p.add_argument('--background',choices=['magenta','auto-frame','pruna-frame','magenta-distance','paint-auto'],default='magenta',help='Per-frame keys require reviewed solid backgrounds and matching corner colors')
    p.add_argument('--root-mode',choices=['pelvis','fixed'],default='pelvis',help='Fixed preserves fluid deformation around a nonhuman actor origin')
    p.add_argument('--expand-canvas',action='store_true',help='Grow the canvas and offset its pivot rather than clipping legitimate expansions')
    p.add_argument('--matte-cleanup',action='store_true',help='Remove background color from partial-alpha paint edges without eroding props')
    p.add_argument('--refine-edges',action='store_true',help='Use nearby foreground colors to refine compatible pale boundary pixels; inspect thin props')
    p.add_argument('--despill-magenta-edges',action='store_true',help='Remove residual magenta fringe on exposed pixel-art silhouettes')
    p.add_argument('--key-magenta-gaps',action='store_true',help='Opt-in: remove saturated magenta islands when the actor palette excludes pink')
    a=p.parse_args();compile_motion(a.video,a.reference,a.output,a.action,a.frames,a.loop,a.start,a.end,a.style,a.component_mode,a.ping_pong,a.background,a.root_mode,a.expand_canvas,a.matte_cleanup,a.refine_edges,a.despill_magenta_edges,a.key_magenta_gaps)
