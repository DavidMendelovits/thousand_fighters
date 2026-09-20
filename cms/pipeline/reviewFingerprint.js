import { digest, segment } from '../storage/LineageStore.js';
import { currentConceptAssetKey } from '../authoring/referenceArt.js';

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(item => stableJson(item ?? null)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function relativeFile(file) {
  if (typeof file !== 'string' || !file || file.startsWith('/') || file.includes('\\') || /[:?#]/.test(file) || file.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe review asset path.');
  return file;
}

/** One fresh read per asset per check. No cross-request cache can mask edits. */
export async function loadReviewContext(repository, characterId, suppliedDraft) {
  segment(characterId);
  const draft = suppliedDraft ?? await repository.getDraft(characterId);
  const storage = repository.storage;
  const root = draft.assets?.rootKey ?? `characters/${characterId}/assets/fighter-pack`;
  if (!root.startsWith(`characters/${characterId}/assets/`) || root.split('/').some(p => p === '..' || p === '.')) throw new Error('Invalid active review pack.');
  const frameData = await storage.exists(`${root}/frameData.json`) ? await storage.getJson(`${root}/frameData.json`) : {frames:draft.sprite?.frames ?? {}};
  const manifest = await storage.exists(`${root}/manifest.json`) ? await storage.getJson(`${root}/manifest.json`) : null;
  const conceptKey = await currentConceptAssetKey(repository, characterId);
  const conceptHash = conceptKey ? digest(await storage.getBytes(conceptKey)) : null;
  const cache = new Map();
  let active = 0;
  const waiting = [];
  async function readHash(key) {
    if (active >= 8) await new Promise(resolve => waiting.push(resolve));
    active++;
    try { return await storage.exists(key) ? digest(await storage.getBytes(key)) : null; }
    finally { active--; waiting.shift()?.(); }
  }
  const hash = file => {
    relativeFile(file);
    if (!cache.has(file)) cache.set(file, readHash(`${root}/${file}`));
    return cache.get(file);
  };
  return {draft, storage, root, frameData, manifest, conceptKey, conceptHash, hash};
}

export async function motionFingerprint(context, action) {
  segment(action);
  const {draft, frameData, hash, conceptHash} = context;
  const frames = frameData.frames?.[action] ?? [];
  if (!Array.isArray(frames) || !frames.length) return {fingerprint:null, missing:['extracted frames']};
  const actor = draft.actors?.find(a => a.idleAnimation === action || draft.moves?.some(m => m.animation === action && m.controlledActor === a.id));
  const referenceRow = actor?.idleAnimation ?? 'base';
  const referenceFrames = frameData.frames?.[referenceRow] ?? [];
  const files = [...new Set([`sheets/${action}.png`, ...frames.map(f => f.file), ...referenceFrames.map(f => f.file)])];
  const assets = await Promise.all(files.map(async file => ({file:relativeFile(file),sha256:await hash(file)})));
  const missing = assets.filter(asset => !asset.sha256).map(asset => asset.file);
  const moves = (draft.moves ?? []).filter(move => move.animation === action || move.requiredAnimation === action);
  // Runtime now reaches the last held pose. Reviews made under the old sampler
  // must be revisited even when pixels and authored collision ticks are unchanged.
  const hasActorGrip = moves.some(move => move.phases?.some(phase => phase.events?.some(({event}) => event?.grab?.actorGrip || event?.projectile?.grab?.actorGrip)));
  const fingerprint = digest(Buffer.from(stableJson({schema:2, action, frames, assets, conceptHash,
    referenceFrames, artStyle:draft.artStyle, scale:{relativeHeight:draft.sprite?.relativeHeight,scaleAdjust:draft.sprite?.scaleAdjust},
    playback:draft.sprite?.rowPlayback?.[action], actor,
    moves, overrides:draft.overrides, heldGripPlayback:hasActorGrip ? 'inclusive-final-tick-v1' : undefined,
    sourceSha256:draft.motionRows?.[action]?.sourceSha256,
  })));
  return {fingerprint, missing};
}

export function motionReviewStatus(report, fingerprint, missing = []) {
  if (missing.length) return 'missing-assets';
  if (report?.clippedFrames?.length) return 'rejected';
  if (report?.review?.decision === 'changes-requested') return report.review.fingerprint === fingerprint ? 'changes-requested' : 'stale-review';
  if (!report || report.uniqueFrames < 8) return 'needs-motion';
  if (report.status !== 'approved') return 'needs-review';
  if (!report.review?.fingerprint) return 'unversioned-review';
  return report.review.fingerprint === fingerprint ? 'approved' : 'stale-review';
}

/** QA covers runtime pack bytes and authored rules, not mutable review notes. */
export async function packFingerprint(context) {
  const {draft,storage,root,hash,conceptHash} = context;
  const keys = (await storage.list(root)).filter(key => key.startsWith(`${root}/`)).map(key => key.slice(root.length+1)).filter(file => !file.startsWith('motion/') && !file.endsWith('.mp4')).sort();
  const assets = await Promise.all(keys.map(async file => ({file,sha256:await hash(file)})));
  const {updatedAt, lifecycle, history, generation, referenceReview, motionRows, workbench, ...rules} = draft;
  return digest(Buffer.from(stableJson({schema:1,assets,rules,conceptHash})));
}
