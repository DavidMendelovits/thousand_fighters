export type ClipPoint = { x: number; y: number };
export type AnimationClipFrame = {
  x: number; y: number; width: number; height: number;
  durationTicks: number; sourceFrame: number; sourceTimeMs: number;
  rootMotion: ClipPoint; offset?: ClipPoint; sockets: Record<string, ClipPoint>;
};
export type AnimationClipLayer = {
  id: string; role: string; z: number; blend: 'normal' | 'add';
  sheet: string; frames: AnimationClipFrame[];
};
export type AnimationClipEvent = { tick: number; type: string; label: string; [key: string]: unknown };
export type AnimationClip = {
  schemaVersion: 1; id: string; displayName: string; kind: string;
  playback: 'loop' | 'once' | 'hold'; tickRate: number; totalTicks: number;
  canvas: { width: number; height: number }; anchor: ClipPoint;
  rootMode: 'in-place' | 'extract' | 'baked'; layers: AnimationClipLayer[];
  events: AnimationClipEvent[];
  intent: { topologyChanges: boolean; scaleChanges: boolean; paletteChanges: boolean };
  qa: { status: 'needs-review' | 'rejected' | 'approved'; checks: Array<{ id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }>; warnings: string[] };
  provenance: { method: string; description?: string; [key: string]: unknown };
};

/** Validate untrusted manifests before allocating textures or drawing frames. */
export function parseAnimationClip(value: unknown): AnimationClip {
  const fail = (message: string): never => { throw new Error(`Invalid clip: ${message}`); };
  const object = (v: unknown, name: string): Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail(`${name} must be an object`);
  const text = (v: unknown, name: string): void => { if (typeof v !== 'string' || !v.trim()) fail(`${name} must be a nonempty string`); };
  const number = (v: unknown, name: string, min = 0, max = 1e7): void => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(`${name} is out of range`);
  };
  const integer = (v: unknown, name: string, min = 0, max = 1e7): void => {
    number(v, name, min, max); if (!Number.isInteger(v)) fail(`${name} must be an integer`);
  };
  const point = (v: unknown, name: string): void => {
    const p = object(v, name); number(p.x, `${name}.x`, -1e5, 1e5); number(p.y, `${name}.y`, -1e5, 1e5);
  };
  const clip = object(value, 'manifest');
  if (clip.schemaVersion !== 1) fail('schemaVersion must be 1');
  for (const key of ['id', 'displayName', 'kind']) text(clip[key], key);
  if (!['loop', 'once', 'hold'].includes(String(clip.playback))) fail('unknown playback mode');
  if (!['in-place', 'extract', 'baked'].includes(String(clip.rootMode))) fail('unknown root mode');
  integer(clip.tickRate, 'tickRate', 1, 240); integer(clip.totalTicks, 'totalTicks', 1, 216000);
  const canvas = object(clip.canvas, 'canvas');
  integer(canvas.width, 'canvas.width', 1, 4096); integer(canvas.height, 'canvas.height', 1, 4096);
  point(clip.anchor, 'anchor');
  if (!Array.isArray(clip.layers) || clip.layers.length < 1 || clip.layers.length > 32) fail('expected 1–32 layers');
  const ids = new Set<string>();
  let timing: number[] | undefined;
  for (const rawLayer of clip.layers as unknown[]) {
    const layer = object(rawLayer, 'layer');
    for (const key of ['id', 'role', 'sheet']) text(layer[key], `layer.${key}`);
    if (ids.has(String(layer.id))) fail('duplicate layer id');
    ids.add(String(layer.id)); number(layer.z, 'layer.z', -1e4, 1e4);
    if (!['normal', 'add'].includes(String(layer.blend))) fail('unknown layer blend');
    if (!Array.isArray(layer.frames) || layer.frames.length < 1 || layer.frames.length > 4096) fail('expected 1–4096 frames per layer');
    const durations: number[] = [];
    for (const rawFrame of layer.frames as unknown[]) {
      const frame = object(rawFrame, 'frame');
      integer(frame.x, 'frame.x', 0, 32768); integer(frame.y, 'frame.y', 0, 32768);
      if (frame.width !== canvas.width || frame.height !== canvas.height) fail('frame dimensions must match shared canvas');
      integer(frame.durationTicks, 'frame.durationTicks', 1, 216000);
      integer(frame.sourceFrame, 'frame.sourceFrame'); number(frame.sourceTimeMs, 'frame.sourceTimeMs');
      point(frame.rootMotion, 'frame.rootMotion');
      if (frame.offset !== undefined) point(frame.offset, 'frame.offset');
      const sockets = object(frame.sockets, 'frame.sockets');
      for (const [name, socket] of Object.entries(sockets)) point(socket, `socket ${name}`);
      durations.push(frame.durationTicks as number);
    }
    if (durations.reduce((a, b) => a + b, 0) !== clip.totalTicks) fail('frame durations must sum to totalTicks');
    if (timing && (durations.length !== timing.length || durations.some((duration, i) => duration !== timing![i]))) fail('layer timings must match');
    timing = durations;
  }
  if (!Array.isArray(clip.events) || clip.events.length > 4096) fail('events must be an array of at most 4096 entries');
  for (const rawEvent of clip.events as unknown[]) {
    const event = object(rawEvent, 'event');
    integer(event.tick, 'event.tick', 0, (clip.totalTicks as number) - 1);
    text(event.type, 'event.type'); text(event.label, 'event.label');
  }
  const intent = object(clip.intent, 'intent');
  for (const key of ['topologyChanges', 'scaleChanges', 'paletteChanges']) if (typeof intent[key] !== 'boolean') fail(`intent.${key} must be boolean`);
  const qa = object(clip.qa, 'qa');
  if (!['needs-review', 'rejected', 'approved'].includes(String(qa.status))) fail('unknown QA status');
  if (!Array.isArray(qa.warnings) || qa.warnings.some(w => typeof w !== 'string')) fail('qa.warnings must be strings');
  if (!Array.isArray(qa.checks)) fail('qa.checks must be an array');
  for (const rawCheck of qa.checks as unknown[]) {
    const check = object(rawCheck, 'QA check');
    for (const key of ['id', 'label']) text(check[key], `QA check ${key}`);
    if (typeof check.detail !== 'string' || !['pass', 'warn', 'fail'].includes(String(check.status))) fail('invalid QA check');
  }
  text(object(clip.provenance, 'provenance').method, 'provenance.method');
  return value as AnimationClip;
}

/** Pure, deterministic playback. Once/hold both retain their final display pose. */
export function evaluateAnimationClip(clip: AnimationClip, tick: number) {
  const safeTick = Number.isFinite(tick) ? Math.max(0, tick) : 0;
  const currentTick = clip.playback === 'loop'
    ? Math.floor(safeTick % clip.totalTicks)
    : Math.min(clip.totalTicks - 1, Math.floor(safeTick));
  let endTick = 0;
  let frameIndex = 0;
  const frames = clip.layers[0].frames;
  for (let i = 0; i < frames.length; i++) {
    endTick += frames[i].durationTicks;
    if (currentTick < endTick) { frameIndex = i; break; }
  }
  return {
    tick: currentTick, frameIndex,
    finished: clip.playback !== 'loop' && safeTick >= clip.totalTicks,
    layers: clip.layers.map(layer => ({ layer, frame: layer.frames[frameIndex] })).sort((a, b) => a.layer.z - b.layer.z),
    events: clip.events.filter(event => event.tick === currentTick),
  };
}
