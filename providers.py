"""Image models behind one interface, for paint.py.

Every adapter does one thing: paint(prompt, input image paths, out path, size 'WxH') writes one image to out.
What differs between models lives in image_models.json, not in the pipeline:

    sizes        sizes or aspect ratios the model can make; a request is sent at the nearest one
    transparent  true: ask for a transparent background. false: never ask. null: ask, and fall back to magenta
                 if the model refuses (BackgroundUnsupported)
    key          "auto": if the model painted a flat backdrop that isn't magenta, turn it magenta before keying.
                 "magenta": trust the magenta backdrop the prompt asks for
    max_refs     how many input images one request may carry (pose mode drops the nearest-pose image to fit)
    cost         estimated USD per image, with cost_source saying where the figure came from
    extra        fields sent as-is in the request body (quality, resolution, safety settings...)
    ref_field    fal only: the input field for reference images, when it can't be told from the model id

After any adapter writes, normalize() brings the file to the size that was asked for and to a magenta or
transparent background, so keying, snapping to the rig and qa.py never see which model painted it.

Name a model with --model:
    a name in image_models.json     (nano-banana-2, flux-2-pro, gpt-image-2 ...)
    provider:model id               (fal:fal-ai/nano-banana-pro/edit, bfl:flux-2-pro, openai:gpt-image-2)
    a bare OpenAI model name        (gpt-image-2; through the codex CLI when OPENAI_API_KEY isn't set, as before)

The fal, BFL and Gemini adapters are ported from v1's JS adapters (cms/pipeline/adapters on DM/cms-admin-platform),
which had already worked out each API's request shape, polling and default prices. v1's MiniMax image-01 adapter
isn't ported: it takes one subject reference, and paint.py sends at least two images (character and pose guide).

Adding a model: an entry in image_models.json if its provider already has an adapter, otherwise a class here
with a paint() method, registered in ADAPTERS.
"""
import base64, glob, json, os, subprocess, tempfile, time
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
MAGENTA = (255, 0, 255)
DEFAULTS = {'sizes': ['1024x1024', '1536x1024', '1024x1536'], 'transparent': False, 'key': 'auto', 'max_refs': 4,
            'cost': None, 'cost_source': None, 'extra': {}}


class BackgroundUnsupported(RuntimeError):
    """The API refused a transparent background for this model (gpt-image-2 has returned 400 for it since Sep 30 2026)."""


class Model:
    """One configured image model: who serves it, its id there, and its settings."""

    def __init__(self, name, provider, model_id, **settings):
        self.name, self.provider, self.id = name, provider, model_id
        s = {**DEFAULTS, **{k: v for k, v in settings.items() if v is not None or k == 'transparent'}}
        for k, v in s.items(): setattr(self, k, v)
        self.adapter = ADAPTERS[provider]()

    @property
    def label(self):  # what paint.json records, e.g. openai:gpt-image-2
        return f'{self.provider}:{self.id or "default"}'

    def missing_key(self):
        env = self.adapter.env
        return env if env and not os.environ.get(env) else None

    def paint(self, prompt, images, out, size, background='magenta', quality=None):
        """Paint one image at the model's nearest supported size, then normalize it to `size`. Returns info for the run log."""
        if len(images) > self.max_refs: raise ValueError(f'{self.name} takes at most {self.max_refs} images, got {len(images)}')
        if self.missing_key(): raise RuntimeError(f'{self.name} needs {self.missing_key()}')
        sent = nearest_size(size, self.sizes)
        t = time.time()
        extra = self.adapter.paint(self, prompt, images, out, sent, background, quality) or {}
        info = {'sent_size': sent, 'seconds': round(time.time() - t, 1), **extra}
        info.update(normalize(out, size, self.key))
        return info


def load_models(path=None):
    path = path or os.path.join(HERE, 'image_models.json')
    raw = json.load(open(path)) if os.path.exists(path) else {}
    return {k: v for k, v in raw.items() if not k.startswith('_')}


def resolve(name, path=None):
    """--model value -> Model. None means the codex CLI (no API key), as paint.py always did."""
    table = load_models(path)
    if name in table:
        e = dict(table[name]); return Model(name, e.pop('provider'), e.pop('model'), **e)
    if name and ':' in name:
        prov, mid = name.split(':', 1)
        if prov not in ADAPTERS: raise SystemExit(f'unknown provider {prov!r}; known: {", ".join(ADAPTERS)}')
        return Model(name, prov, mid, transparent=None if prov == 'openai' else False)
    if os.environ.get('OPENAI_API_KEY'):
        if not name: raise SystemExit('Set the image model: --model <name> or OPENAI_IMAGE_MODEL (gpt-image-1 was shut down Oct 2026).')
        return Model(name, 'openai', name, transparent=None)
    return Model('codex', 'codex', os.environ.get('CODEX_MODEL'), max_refs=8)


# ---- normalizing: any model's output -> the size asked for, on magenta or transparent ---------------------------

def parse(size):
    w, h = size.lower().split('x'); return int(w), int(h)


def nearest_size(size, sizes):
    """The supported entry closest in aspect ratio, then in area. Entries are 'WxH' or an aspect ratio like '3:2'."""
    w, h = parse(size)
    def score(s):
        if ':' in s: a, b = map(float, s.split(':')); return (abs(np.log((a / b) / (w / h))), 0)
        sw, sh = parse(s); return (abs(np.log((sw / sh) / (w / h))), abs(np.log(sw * sh / (w * h))))
    return min(sizes, key=score) if sizes else size


def backdrop(a):
    """The flat colour around the edge of an RGB(A) array, or None if the edge isn't one colour."""
    edge = np.concatenate([a[:3].reshape(-1, a.shape[2]), a[-3:].reshape(-1, a.shape[2]),
                           a[:, :3].reshape(-1, a.shape[2]), a[:, -3:].reshape(-1, a.shape[2])])[:, :3].astype(int)
    med = np.median(edge, axis=0)
    close = (np.abs(edge - med).sum(axis=1) < 60).mean()
    return med if close > 0.85 else None


def to_magenta(im, tol=60):
    """Flood the flat backdrop that touches the image border to pure magenta, so key() can remove it.
    Only colour connected to the border changes, so a character wearing the backdrop colour keeps it."""
    a = np.array(im.convert('RGBA')).astype(int)
    if (a[..., 3] < 250).mean() > 0.05: return im, None  # already has real transparency
    bg = backdrop(a)
    if bg is None or (min(bg[0], bg[2]) - bg[1]) > 90: return im, None  # no flat backdrop, or it's magenta already
    near = np.abs(a[..., :3] - bg).sum(axis=2) < tol
    lab, _ = ndimage.label(near)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    fill = np.isin(lab, border[border > 0])
    a[fill, :3] = MAGENTA
    return Image.fromarray(a.astype(np.uint8)), [int(x) for x in bg]


def normalize(out, size, key='auto'):
    """Rewrite out at exactly `size`. Same aspect: plain resize. Different aspect: stretched back, and logged,
    because the layout in the guide is what the cells are cut from. key 'auto' also turns a flat non-magenta
    backdrop magenta. Returns what it changed."""
    im = Image.open(out); im.load(); info = {}
    if key == 'auto':
        im2, bg = to_magenta(im)
        if bg is not None: im, info['backdrop_keyed'] = im2, bg
    w, h = parse(size)
    if im.size != (w, h):
        info['got_size'] = f'{im.width}x{im.height}'
        if abs(np.log((im.width / im.height) / (w / h))) > 0.03: info['stretched'] = True
        im = im.resize((w, h), Image.LANCZOS)
    im.save(out, 'PNG')
    return info


# ---- adapters -----------------------------------------------------------------------------------------------

def curl_json(url, headers, body=None, timeout=600):
    """POST (or GET with no body) through curl, body sent from a temp file so big base64 images don't hit argv limits."""
    cmd = ['curl', '-sS', '--max-time', str(timeout)] + [x for h in headers for x in ('-H', h)]
    tmp = None
    if body is not None:
        tmp = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False); json.dump(body, tmp); tmp.close()
        cmd += ['-H', 'Content-Type: application/json', '--data-binary', '@' + tmp.name]
    try:
        r = subprocess.run(cmd + [url], capture_output=True, text=True)
    finally:
        if tmp: os.unlink(tmp.name)
    try: return json.loads(r.stdout or '{}')
    except json.JSONDecodeError: raise RuntimeError(f'not JSON from {url.split("?")[0]}: {(r.stdout + r.stderr)[:300]}')


def download(url, out):
    r = subprocess.run(['curl', '-sS', '-L', '--max-time', '300', '-o', out, url], capture_output=True, text=True)
    if r.returncode or not os.path.exists(out): raise RuntimeError('download failed: ' + r.stderr[:300])


def b64(path):
    return base64.b64encode(open(path, 'rb').read()).decode()


def ratio(size):
    """'1536x1024' -> '3:2' (an aspect ratio string the hosted APIs take)."""
    from math import gcd
    w, h = parse(size); g = gcd(w, h); return f'{w // g}:{h // g}'


class OpenAI:
    """OpenAI Images API at OPENAI_BASE_URL (default api.openai.com): generations for no images, edits with images."""
    env = 'OPENAI_API_KEY'

    def paint(self, m, prompt, images, out, size, background, quality):
        k = os.environ['OPENAI_API_KEY']
        base = os.environ.get('OPENAI_BASE_URL', 'https://api.openai.com/v1').rstrip('/')
        quality = quality or m.extra.get('quality')
        cmd = ['curl', '-sS', '--max-time', '600', '-H', f'Authorization: Bearer {k}']
        if images:  # edits takes multipart; generations only takes JSON
            cmd += ['--form-string', f'model={m.id}', '--form-string', f'prompt={prompt}', '--form-string', f'size={size}']
            if quality: cmd += ['--form-string', f'quality={quality}']
            if background == 'transparent':
                cmd += ['--form-string', 'background=transparent', '--form-string', 'output_format=png']
            cmd += [f'{base}/images/edits'] + [x for i in images for x in ('-F', f'image[]=@{i}')]
        else:
            body = {'model': m.id, 'prompt': prompt, 'size': size}
            if quality: body['quality'] = quality
            cmd += ['-H', 'Content-Type: application/json', '-d', json.dumps(body), f'{base}/images/generations']
        res = json.loads(subprocess.run(cmd, capture_output=True, text=True).stdout or '{}')
        if 'data' not in res:
            err = str(res.get('error', res))[:300]
            if background == 'transparent' and ('transparent' in err.lower() or 'background' in err.lower()):
                raise BackgroundUnsupported(err)
            raise RuntimeError(err)
        open(out, 'wb').write(base64.b64decode(res['data'][0]['b64_json']))


class Codex:
    """The codex CLI's image tool (CODEX_MODEL to pick its model). Can't ask for transparency."""
    env = None

    def paint(self, m, prompt, images, out, size, background, quality):
        start = time.time() - 3
        cx = ['codex', 'exec', '--sandbox', 'workspace-write', '--skip-git-repo-check']
        if m.id: cx += ['--model', m.id]
        for i in images: cx += ['-i', i]
        run = subprocess.run(cx, input=prompt + '\nGenerate exactly one image with your image generation tool. Do not write code or other files.',
                             text=True, capture_output=True, timeout=600)
        new = [f for f in glob.glob(os.path.expanduser('~/.codex/generated_images/**/*.png'), recursive=True) if os.path.getmtime(f) >= start]
        if not new: raise RuntimeError('codex produced no image: ' + (run.stdout + run.stderr)[-300:].strip())
        Image.open(max(new, key=os.path.getmtime)).convert('RGB').save(out)


class NoRetry(RuntimeError):
    """The provider may already have accepted and billed this job: don't send it again automatically."""


def data_url(path):
    return f'data:image/png;base64,{b64(path)}'


def save_image(img, out):
    """Write a returned image: a URL, a data URL, or {url | content | base64}. Ported from v1's fal adapter."""
    if isinstance(img, dict):
        raw = img.get('content') or img.get('base64')
        if raw: open(out, 'wb').write(base64.b64decode(raw)); return
        img = img.get('url')
    if not img: raise RuntimeError('no image in the response')
    if img.startswith('data:'): open(out, 'wb').write(base64.b64decode(img.split(',', 1)[1]))
    else: download(img, out)


class Fal:
    """fal.ai hosted models (FAL_KEY). Ported from v1's FalImageGeneratorAdapter (cms/pipeline/adapters on
    DM/cms-admin-platform): queue.fal.run submit, poll status_url until COMPLETED, read response_url; input images as
    data URLs in image_urls for /edit models (image_url for instant-character and subject-reference models, or set
    ref_field). Sizes are aspect ratios; `extra` carries model fields such as resolution."""
    env = 'FAL_KEY'

    def paint(self, m, prompt, images, out, size, background, quality):
        auth = [f'Authorization: Key {os.environ["FAL_KEY"]}']
        base = os.environ.get('FAL_QUEUE_BASE_URL', 'https://queue.fal.run').rstrip('/')
        body = {'prompt': prompt, 'num_images': 1, 'output_format': 'png', **m.extra}
        body['aspect_ratio'] = size if ':' in size else ratio(size)
        field = getattr(m, 'ref_field', None) or ('image_urls' if '/edit' in m.id else 'image_url' if ('instant-character' in m.id or 'subject-reference' in m.id) else None)
        if images:
            if not field: raise ValueError(f'{m.name}: no reference field known for {m.id}; set ref_field in image_models.json')
            body[field] = [data_url(i) for i in images] if field.endswith('_urls') else data_url(images[0])
        job = curl_json(f'{base}/{m.id}', auth, body)
        if not job.get('request_id') and not job.get('response_url'): raise RuntimeError(str(job.get('detail', job))[:300])
        status = job.get('status_url') or f'{base}/{m.id}/requests/{job["request_id"]}/status'
        result = job.get('response_url') or f'{base}/{m.id}/requests/{job["request_id"]}'
        try:
            for _ in range(300):
                st = curl_json(status, auth)
                if st.get('status') == 'COMPLETED': break
                if st.get('status') in ('FAILED', 'CANCELLED'): raise RuntimeError(f'fal {st["status"]}: {st.get("error", "no reason given")}')
                time.sleep(1)
            else: raise RuntimeError('fal job timed out')
            res = curl_json(result, auth)
            img = (res.get('images') or [None])[0] or res.get('image') or ((res.get('output') or {}).get('images') or [None])[0]
            save_image(img, out)
        except Exception as e:
            raise NoRetry(f'{e} (fal request {job.get("request_id")} may already be billed)')
        return {'job': job.get('request_id')}


class BFL:
    """Black Forest Labs API (BFL_API_KEY): FLUX.2 [pro], [klein], Kontext. Ported from v1's BflFluxKleinGeneratorAdapter:
    references as data URLs in input_image, input_image_2... (up to 8), submit, poll polling_url until Ready, download
    result.sample. Once a job is accepted it is never resent automatically (it may already be billed). Records the
    credits BFL reports."""
    env = 'BFL_API_KEY'

    def paint(self, m, prompt, images, out, size, background, quality):
        auth = [f'x-key: {os.environ["BFL_API_KEY"]}', 'accept: application/json']
        body = {'prompt': prompt, 'output_format': 'png', **m.extra}
        if ':' in size: body['aspect_ratio'] = size
        else: body['width'], body['height'] = parse(size)
        for n, i in enumerate(images): body['input_image' if n == 0 else f'input_image_{n + 1}'] = data_url(i)
        base = os.environ.get('BFL_API_BASE_URL', 'https://api.bfl.ai').rstrip('/')
        try: job = curl_json(f'{base}/v1/{m.id}', auth, body)
        except Exception as e: raise NoRetry(f'{e} (a dropped submit may already be billed)')
        if not job.get('polling_url') and not job.get('id'): raise RuntimeError(str(job)[:300])
        poll = job.get('polling_url') or f'{base}/v1/get_result?id={job["id"]}'
        try:
            for _ in range(600):
                time.sleep(1)
                r = curl_json(poll, auth)
                if r.get('status') == 'Ready':
                    save_image((r.get('result') or {}).get('sample') or r.get('sample'), out)
                    return {'job': job.get('id'), 'credits': job.get('cost')}
                if r.get('status') in ('Error', 'Failed', 'Request Moderated', 'Content Moderated'):
                    raise RuntimeError(f'BFL {r["status"]}: {r.get("error") or r.get("failure_reason") or "no reason given"}')
            raise RuntimeError('BFL job timed out')
        except Exception as e:
            raise NoRetry(f'{e} (BFL job {job.get("id")} may already be billed)')


class Gemini:
    """Google Gemini image models direct (GEMINI_API_KEY). Ported from v1's GeminiFlashImageGeneratorAdapter: the
    interactions endpoint, prompt then images as inline base64, image_size from extra (default 1K)."""
    env = 'GEMINI_API_KEY'

    def paint(self, m, prompt, images, out, size, background, quality):
        base = os.environ.get('GEMINI_API_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta').rstrip('/')
        body = {'model': m.id, 'input': [{'type': 'text', 'text': prompt}] + [{'type': 'image', 'mime_type': 'image/png', 'data': b64(i)} for i in images],
                'response_format': {'type': 'image', 'mime_type': 'image/png', 'aspect_ratio': size if ':' in size else ratio(size),
                                    'image_size': m.extra.get('image_size', '1K')}}
        res = curl_json(f'{base}/interactions', [f'x-goog-api-key: {os.environ["GEMINI_API_KEY"]}'], body)
        parts = [p for c in res.get('candidates', []) for p in (c.get('content') or {}).get('parts', [])]
        legacy = next((p.get('inlineData') or p.get('inline_data') for p in parts if (p.get('inlineData') or p.get('inline_data') or {}).get('data')), None)
        found = res.get('output_image') or next((p for p in (res.get('output') or res.get('outputs') or []) if isinstance(p, dict) and p.get('type') == 'image'), None) or legacy
        if not found or not found.get('data'): raise RuntimeError('Gemini returned no image: ' + str(res.get('error', res))[:300])
        open(out, 'wb').write(base64.b64decode(found['data']))


class Fixture:
    """Offline stand-in that costs nothing: paints the last input image (the pose guide) back, so the whole pipeline
    runs without a key. extra.scale / extra.shift (fraction of the frame) / extra.backdrop (RGB) / extra.out_size
    make it misbehave the way real models do, to test the normalizer."""
    env = None

    def paint(self, m, prompt, images, out, size, background, quality):
        w, h = parse(m.extra.get('out_size', size if ':' not in size else '1024x1024'))
        bd = tuple(m.extra.get('backdrop', MAGENTA))
        canvas = Image.new('RGB', (w, h), bd)
        if images:
            src = Image.open(images[-1]).convert('RGB')
            fig = Image.fromarray(np.array(src))
            a = np.array(fig).astype(int)
            mask = Image.fromarray(((np.minimum(a[..., 0], a[..., 2]) - a[..., 1]) <= 90).astype(np.uint8) * 255)
            s = m.extra.get('scale', 1.0)
            fw, fh = round(w * s), round(h * s)
            fig, mask = fig.resize((fw, fh), Image.LANCZOS), mask.resize((fw, fh), Image.NEAREST)
            dx, dy = m.extra.get('shift', [0, 0])
            canvas.paste(fig, (round((w - fw) / 2 + dx * w), round((h - fh) / 2 + dy * h)), mask)
        else:  # a reference with nothing to copy: a plain grey figure
            g = ImageDraw.Draw(canvas); g.rectangle([w * .42, h * .2, w * .58, h * .9], fill=(80, 80, 90), outline=(20, 20, 20), width=4)
        canvas.save(out)


ADAPTERS = {'openai': OpenAI, 'codex': Codex, 'fal': Fal, 'bfl': BFL, 'gemini': Gemini, 'fixture': Fixture}
