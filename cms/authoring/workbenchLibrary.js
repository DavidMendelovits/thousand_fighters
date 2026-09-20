import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { digest, segment } from '../storage/LineageStore.js';
import { assetApiUrl } from '../assets/uploadCharacterAsset.js';
import { planAnimations } from '../pipeline/animationPlan.js';
import { currentConceptAssetKey } from './referenceArt.js';
import {loadReviewContext,motionFingerprint,motionReviewStatus} from '../pipeline/reviewFingerprint.js';
import {reviewPlayback} from './reviewPlayback.js';

const publicRoot = fileURLToPath(new URL('../../public/', import.meta.url));
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');

/** Working assets only. Archived packs must never masquerade as current art. */
export async function workbenchData(repository, characterId) {
  segment(characterId);
  const draft = await repository.getDraft(characterId);
  const root = draft.assets?.rootKey ?? `characters/${characterId}/assets/fighter-pack`;
  if (!root.startsWith(`characters/${characterId}/assets/`) || root.split('/').includes('..')) throw new Error('Active pack is outside this character.');
  // Summaries use only the active pack. References are resolved separately in
  // workbenchDetail; archived revisions must not slow or inflate the roster.
  const keys = await repository.storage.list(root);
  const frameDataKey = draft.assets?.frameDataKey ?? `${root}/frameData.json`;
  const frameData = await repository.storage.exists(frameDataKey) ? await repository.storage.getJson(frameDataKey) : {};
  const frames = frameData.frames ?? draft.sprite?.frames ?? {};
  const active = keys.filter(key => key.startsWith(`${root}/`));
  const rows = Object.entries(frames).map(([row, list]) => ({
    row, frameCount: list.length,
    moves:(draft.moves??[]).filter(move=>move.animation===row).map(move=>({id:move.id,name:move.name??move.id})),
    available: list.filter(frame => frame.file && active.includes(`${root}/${frame.file}`)).length,
    review: draft.motionRows?.[row]?.status === 'approved' ? 'review recorded · verify version' : draft.motionRows?.[row]?.status ?? 'unreviewed',
    clipUrl: active.includes(`${root}/sheets/${row}.png`) ? `/api/characters/${encodeURIComponent(characterId)}/review-clip/${encodeURIComponent(row)}` : null,
  })).filter(row => row.frameCount > 0);
  // Legacy packs can lack frameData but still contain extracted frames.
  const frameCount = active.filter(key => /\/sprites\/[^/]+\/[^/]+\.png$/.test(key)).length;
  let published = false;
  try {
    const config = JSON.parse(await readFile(`${publicRoot}fighters/${characterId}/config.json`, 'utf8'));
    published = config.id === characterId && config.selectable !== false;
  } catch { /* A draft is not a release. */ }
  const fixture = /^(pw_|cms_test|test_fighter$)/.test(characterId);
  const archived = draft.workbench?.archived === true;
  return { draft, keys, root, frames, summary: {
    id: characterId, displayName: draft.displayName ?? characterId,
    group: archived ? 'archived' : frameCount > 0 && !fixture ? 'animated' : 'drafts',
    frameCount, rows, published, fixture, archived,
    updatedAt: draft.updatedAt, parentId: draft.parentId ?? null,
    motion: planAnimations(draft, frameData).counts,
  } };
}

export async function workbenchLibrary(repository) {
  const entries = await repository.listCharacters();
  return Promise.all(entries.map(async entry => {
    try { return (await workbenchData(repository, entry.id)).summary; }
    catch { return { ...entry, group: 'drafts', frameCount: 0, rows: [], published: false, unavailable: true }; }
  }));
}

export async function workbenchDetail(repository, characterId) {
  const data = await workbenchData(repository, characterId);
  const key = await currentConceptAssetKey(repository, characterId);
  let reference = null;
  if (key) {
    const sha256 = digest(await repository.storage.getBytes(key));
    const review = data.draft.referenceReview;
    reference = { key, sha256, url: `${assetApiUrl(key)}?v=${sha256}`,
      status: review?.sha256 === sha256 ? review.status : 'unreviewed',
      notes: review?.sha256 === sha256 ? review.notes : '',
    };
  }
  return { ...data.summary, reference };
}

export async function updateWorkbench(repository, characterId, input) {
  return repository.withMutation(characterId, async () => {
    const draft = await repository.getDraft(characterId);
    if (typeof input.archived === 'boolean') {
      await repository.saveDraft(characterId, { ...draft, workbench: { ...draft.workbench, archived: input.archived } });
      await repository.storage.lineage.event(characterId, { type: input.archived ? 'workbench-archived' : 'workbench-restored' });
    } else if (['approved', 'rejected'].includes(input.referenceStatus)) {
      const detail = await workbenchDetail(repository, characterId);
      if (!detail.reference || input.sha256 !== detail.reference.sha256) throw Object.assign(new Error('Reference changed. Reload and review the current image.'), { statusCode: 409 });
      if (!String(input.notes ?? '').trim()) throw Object.assign(new Error('Add review notes before saving.'), { statusCode: 400 });
      await repository.saveDraft(characterId, { ...draft, referenceReview: {
        assetKey: detail.reference.key, sha256: input.sha256, status: input.referenceStatus, notes: String(input.notes).trim().slice(0, 2000), reviewedAt: new Date().toISOString(),
      } });
    } else throw Object.assign(new Error('Choose archive/restore or a reference review.'), { statusCode: 400 });
    return workbenchDetail(repository, characterId);
  });
}

/** Adapt the current CMS sheet to the existing Animation Lab, without generating
 * anything or silently treating a published/archived pack as the current draft. */
export async function workbenchReviewClip(repository, characterId, row, options={}) {
  segment(row);
  const { draft, frames, root } = await workbenchData(repository, characterId);
  const source = frames[row];
  if (!source?.length) throw Object.assign(new Error('No extracted frames for this row.'), { statusCode: 404 });
  const sheetKey = `${root}/sheets/${row}.png`;
  const bytes = await repository.storage.getBytes(sheetKey);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngSignature)) throw new Error('Preview requires a valid PNG sheet.');
  // Older packs store tightly cropped sprites centered/bottom-aligned in
  // max-sized sheet cells; newer video packs already have fixed canvases.
  const width = Math.max(...source.map(frame => frame.width)), height = Math.max(...source.map(frame => frame.height));
  const sheetWidth = bytes.readUInt32BE(16), sheetHeight = bytes.readUInt32BE(20);
  const columns = sheetWidth / width;
  const variable = source.some(frame => frame.width !== width || frame.height !== height);
  if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(sheetHeight / height) || source.length > columns * sheetHeight / height || (variable && (columns !== source.length || sheetHeight !== height))) {
    throw new Error('Sheet geometry does not match its frames. Re-extract before previewing.');
  }
  const report = draft.motionRows?.[row];
  const actor = draft.actors?.find(actor => actor.idleAnimation === row || draft.moves?.some(move => move.animation === row && move.controlledActor === actor.id));
  const timing = reviewPlayback(draft,row,source,options);
  const durations = timing.sequence.map(pose=>pose.duration);
  const warnings = ['Preview uses the current CMS draft; it is not a published release.'];
  warnings.push(...timing.warnings);
  if (!report) warnings.push('No video provenance recorded for this row. These may be image keyposes.');
  if (report?.clippedFrames?.length) warnings.push(`Source clipping reported in ${report.clippedFrames.length} frames.`);
  const reviewContext=await loadReviewContext(repository,characterId,draft);
  const current=await motionFingerprint(reviewContext,row);
  const reviewStatus=motionReviewStatus(report,current.fingerprint,current.missing);
  const reviewed=reviewStatus==='approved';
  if(report?.status==='approved'&&!reviewed)warnings.push(`Recorded review is ${reviewStatus}; inspect this version again before publishing.`);
  if(reviewStatus==='changes-requested')warnings.push(`Changes requested: ${report.review.notes}`);
  const cellAnchor = frame => ({ x: Math.floor((width-frame.width)/2)+(frame.anchor?.x??frame.width/2), y: height-frame.height+(frame.anchor?.y??frame.height) });
  const anchor = cellAnchor(source[0]);
  return {
    schemaVersion: 1, id: `${characterId}_${row}`, displayName: `${draft.displayName ?? characterId} · ${row.replaceAll('_', ' ')}`,
    kind: 'cms-draft', tickRate: 60, totalTicks: durations.reduce((a, b) => a + b, 0),
    playback: timing.loop ? 'loop' : 'once', canvas: { width, height }, anchor, rootMode: 'in-place',
    layers: [{ id: actor?.id ?? 'body', role: actor ? 'summon' : 'body', z: 0, blend: 'normal', sheet: `${assetApiUrl(sheetKey)}?v=${digest(bytes)}`, frames: timing.sequence.map(({index,duration}) => { const frame=source[index];return ({
      x: index % columns * width, y: Math.floor(index / columns) * height, width, height,
      durationTicks: duration, sourceFrame: frame.sourceFrame ?? index, sourceTimeMs: frame.sourceTimeMs ?? 0, rootMotion: { x: 0, y: 0 }, offset: { x:anchor.x-cellAnchor(frame).x, y:anchor.y-cellAnchor(frame).y }, sockets: frame.sockets ?? {},
    });}) }], events: timing.events, intent: { topologyChanges: draft.artStyle === 'paint', scaleChanges: draft.artStyle === 'paint', paletteChanges: false },
    qa: { status: report?.clippedFrames?.length||reviewStatus==='changes-requested' ? 'rejected' : reviewed ? 'approved' : 'needs-review', warnings, checks: [] },
    provenance: { method: report?.source ? 'generated-video' : 'cms-extracted-frames', description: timing.description, timingMode:timing.mode,moveId:timing.moveId, characterId, row, sourceTimingKnown: source.every(frame => Number.isFinite(frame.sourceTimeMs)), sourceSha256: report?.sourceSha256 ?? null },
  };
}
