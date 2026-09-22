import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, open, rename, unlink, realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {convertDraftToCharacterConfig, validateCombos} from '../export/convertDraftToCharacterConfig.js';

const VERSION = 1;
const DRAFT = 'characters/palimpsest/draft/content.json';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const slug = value => String(value ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Pure, non-destructive preflight. Never infers combo-exclusive attacks from
 * ordinary legacy routes: the authored moves and their art are preserved. */
export function planPalimpsestComboMigration(draft) {
  const errors = [];
  if (draft?.id !== 'palimpsest') return {ok:false, errors:['Only palimpsest may be migrated.']};
  if (draft.combos !== undefined && !Array.isArray(draft.combos)) errors.push('combos must be an array');
  if (draft.comboRoutes !== undefined && !Array.isArray(draft.comboRoutes)) errors.push('comboRoutes must be an array');
  if (!Array.isArray(draft.moves)) errors.push('moves must be an array');
  else if (draft.moves.some(move => !move || typeof move.id !== 'string' || !move.id.trim())) errors.push('Moves require nonempty string ids');
  if (errors.length) return {ok:false, errors};
  const candidate = structuredClone(draft);
  candidate.combos = candidate.combos ?? [];
  const added = [];
  for (const route of candidate.comboRoutes ?? []) {
    const id = slug(route?.name);
    if (!id || !Array.isArray(route?.moves)) { errors.push('Legacy routes require a name and moves array'); continue; }
    const existing = candidate.combos.find(combo => slug(combo?.id) === id || slug(combo?.displayName) === id);
    if (existing) {
      if (JSON.stringify(existing.segments) !== JSON.stringify(route.moves)) errors.push(`Conflicting legacy and canonical combo "${id}"`);
      else if (existing.purpose && route.purpose && existing.purpose !== route.purpose) errors.push(`Conflicting purpose for combo "${id}"`);
      else if (!existing.purpose && route.purpose) existing.purpose = route.purpose;
      continue;
    }
    candidate.combos.push({id, displayName:route.name, segments:[...route.moves], ...(route.purpose ? {purpose:route.purpose} : {})});
    added.push(id);
  }
  delete candidate.comboRoutes;
  errors.push(...validateCombos(candidate.combos, candidate.moves.map(move => move?.id)));
  if (errors.length) return {ok:false, errors};
  const byId = new Map(candidate.moves.map(move => [move?.id, move]));
  if (byId.size !== candidate.moves.length || byId.has(undefined)) errors.push('Moves require unique ids');
  const owned = new Map();
  for (const combo of candidate.combos) {
    if (typeof combo?.id !== 'string' || !combo.id.trim()) errors.push('Every combo needs a nonempty id');
    if (combo.ownedMoveIds !== undefined && !Array.isArray(combo.ownedMoveIds)) { errors.push(`Invalid owned moves for "${combo.id}"`); continue; }
    if (combo.exclusiveFrom !== undefined && (!Number.isInteger(combo.exclusiveFrom) || combo.exclusiveFrom < 1 || combo.exclusiveFrom >= combo.segments.length)) errors.push(`Invalid exclusiveFrom for "${combo.id}"`);
    const segments = Array.isArray(combo?.segments) ? combo.segments : [];
    for (const [index, id] of segments.entries()) {
      const move = byId.get(id);
      if (!move) continue;
      if (!move.animation || !candidate.sprite?.frames?.[move.animation]?.length) errors.push(`Move "${id}" is missing animation frames for "${move.animation}"`);
      const exclusive = (combo.ownedMoveIds ?? []).includes(id) || (Number.isInteger(combo.exclusiveFrom) && index >= combo.exclusiveFrom);
      if (exclusive) {
        if (index === 0 || !move.trigger?.cancelOnly || !move.trigger?.cancelFrom?.includes(segments[index - 1])) errors.push(`Combo-exclusive move "${id}" needs cancel-only input from its predecessor`);
        if (owned.has(id) && owned.get(id) !== combo.id) errors.push(`Combo-exclusive move "${id}" is owned by multiple combos`);
        owned.set(id, combo.id);
        if (candidate.moves.some(other => other.id !== id && other.animation === move.animation)) errors.push(`Combo-exclusive move "${id}" shares its animation`);
      }
    }
    for (const id of combo.ownedMoveIds ?? []) if (!segments.includes(id)) errors.push(`Owned move "${id}" is not a segment of "${combo.id}"`);
  }
  if (!errors.length) {
    try {
      // Exercise the actual runtime exporter before activation, including
      // actor/control validation and derived cancel edges.
      const runtime = convertDraftToCharacterConfig({draft:candidate, frameData:null, manifest:null});
      for (const combo of candidate.combos) for (let i=1; i<combo.segments.length; i++) {
        const previous = runtime.moves.find(move => move.id === combo.segments[i - 1]);
        const next = runtime.moves.find(move => move.id === combo.segments[i]);
        if (!previous?.cancelInto?.includes(next?.id) || !next?.trigger?.cancelFrom?.includes(previous?.id)) errors.push(`Runtime export lost edge in "${combo.id}"`);
      }
    } catch (error) { errors.push(`Runtime export: ${error.message}`); }
  }
  return {ok:!errors.length, errors, candidate, added, changed:Object.hasOwn(draft, 'comboRoutes'), comboCount:candidate.combos.length};
}

async function paths(rootDir) {
  const root = await realpath(rootDir);
  const draftPath = path.join(root, DRAFT);
  if (await realpath(draftPath) !== draftPath) throw new Error('Migration refuses symlinked draft paths');
  return {root, draftPath, backupRoot:path.join(root, 'migrations', 'palimpsest-combos-v1')};
}

async function checkAnimationFiles(root, candidate) {
  const rootKey = candidate.assets?.rootKey;
  if (typeof rootKey !== 'string' || !rootKey.startsWith('characters/palimpsest/assets/')) return ['Palimpsest assets.rootKey is required for animation-file validation'];
  const assetRoot = path.resolve(root, rootKey);
  if (!assetRoot.startsWith(`${path.join(root, 'characters/palimpsest/assets')}${path.sep}`)) return ['Unsafe animation asset root'];
  const moveIds = new Set(candidate.combos.flatMap(combo => combo.segments));
  const files = new Set(candidate.moves.filter(move => moveIds.has(move.id)).flatMap(move => candidate.sprite.frames[move.animation].map(frame => frame.file)));
  const errors = [];
  for (const file of files) {
    if (typeof file !== 'string' || !file || path.isAbsolute(file)) { errors.push('Animation frames require a relative asset file'); continue; }
    const target = path.resolve(assetRoot, file);
    if (!target.startsWith(`${assetRoot}${path.sep}`)) { errors.push(`Unsafe animation file "${file}"`); continue; }
    try {
      const info = await stat(target);
      if (await realpath(target) !== target || !info.isFile() || info.size === 0) errors.push(`Animation file "${file}" must be a nonempty regular file without symlinks`);
    } catch (error) { if (error.code === 'ENOENT') errors.push(`Missing animation file "${file}"`); else throw error; }
  }
  return errors;
}

async function validateSource(root, original) {
  const plan = planPalimpsestComboMigration(JSON.parse(original));
  if (plan.ok) plan.errors.push(...await checkAnimationFiles(root, plan.candidate));
  plan.ok = plan.errors.length === 0;
  return plan;
}

export async function preflightPalimpsestCombos({rootDir}) {
  const {root, draftPath} = await paths(rootDir);
  const original = await readFile(draftPath);
  const plan = await validateSource(root, original);
  const {candidate, ...report} = plan;
  return {...report, sourceHash:digest(original), ...(candidate ? {candidateHash:digest(json(candidate))} : {})};
}

async function durableWrite(destination, bytes) {
  const file = await open(destination, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
async function syncDirectory(directory) {
  const file = await open(directory, 'r');
  try { await file.sync(); } finally { await file.close(); }
}
async function atomicReplace(destination, bytes, expectedHash) {
  const temporary = `${destination}.${randomUUID()}.migration-tmp`;
  try {
    await durableWrite(temporary, bytes);
    if (digest(await readFile(destination)) !== expectedHash) throw new Error('Draft changed since preflight; refusing to overwrite concurrent edits');
    await rename(temporary, destination);
    await syncDirectory(path.dirname(destination));
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

/** Offline migration deliberately requires all CMS/job writers to be stopped.
 * The lock serializes migration/rollback processes; current FileCmsStorage does
 * not implement compare-and-swap, so this lock is NOT a live CMS writer fence.
 * Never reclaim a stale lock automatically: inspect its PID before removing it.
 *
 * preflight -> backup + candidate + manifest (fsync) -> hash check -> rename
 * Crash before rename leaves original. Crash after rename leaves a complete
 * rollback bundle; rollback uses hashes, never an unreliable success marker.
 */
async function withLock(rootDir, writersStopped, operation) {
  if (writersStopped !== true) throw new Error('Stop CMS and generation workers first; activation/rollback requires writersStopped=true');
  const location = await paths(rootDir);
  await mkdir(location.backupRoot, {recursive:true});
  if (await realpath(location.backupRoot) !== location.backupRoot) throw new Error('Migration refuses symlinked backup paths');
  const lockPath = path.join(location.backupRoot, '.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another migration owns the lock; inspect it before recovery'); throw error; }
  try {
    await lock.writeFile(json({pid:process.pid, startedAt:new Date().toISOString()}));
    await lock.sync();
    return await operation(location);
  } finally { await lock.close(); await unlink(lockPath); }
}

export async function activatePalimpsestCombos({rootDir, expectedHash, writersStopped=false}) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash ?? '')) throw new Error('Activation requires the sourceHash from preflight');
  return withLock(rootDir, writersStopped, async ({root, draftPath, backupRoot}) => {
    const original = await readFile(draftPath);
    if (digest(original) !== expectedHash) throw new Error('Draft changed since preflight; rerun preflight');
    const plan = await validateSource(root, original);
    if (!plan.ok) throw new Error(`Migration validation failed: ${plan.errors.join('; ')}`);
    if (!plan.changed) return {status:'already-canonical', sourceHash:expectedHash};
    const candidate = json(plan.candidate);
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
    const bundleDir = path.join(backupRoot, id);
    await mkdir(bundleDir);
    const manifest = {version:VERSION, id, characterId:'palimpsest', root, draft:DRAFT, createdAt:new Date().toISOString(), sourceHash:expectedHash, candidateHash:digest(candidate), added:plan.added};
    await durableWrite(path.join(bundleDir, 'original.json'), original);
    await durableWrite(path.join(bundleDir, 'candidate.json'), candidate);
    await durableWrite(path.join(bundleDir, 'manifest.json'), json(manifest));
    await syncDirectory(bundleDir);
    await syncDirectory(backupRoot);
    await atomicReplace(draftPath, candidate, expectedHash);
    return {status:'activated', bundleDir, ...manifest};
  });
}

export async function rollbackPalimpsestCombos({rootDir, bundleDir, writersStopped=false}) {
  return withLock(rootDir, writersStopped, async ({root, draftPath, backupRoot}) => {
    const bundle = await realpath(bundleDir);
    if (path.dirname(bundle) !== backupRoot) throw new Error('Rollback bundle must belong to this storage root');
    const manifest = JSON.parse(await readFile(path.join(bundle, 'manifest.json')));
    if (manifest.version !== VERSION || manifest.characterId !== 'palimpsest' || manifest.root !== root || manifest.draft !== DRAFT) throw new Error('Invalid migration manifest');
    const original = await readFile(path.join(bundle, 'original.json'));
    const candidate = await readFile(path.join(bundle, 'candidate.json'));
    if (digest(original) !== manifest.sourceHash || digest(candidate) !== manifest.candidateHash) throw new Error('Rollback bundle checksum mismatch');
    const currentHash = digest(await readFile(draftPath));
    if (currentHash === manifest.sourceHash) return {status:'already-rolled-back', bundleDir:bundle};
    if (currentHash !== manifest.candidateHash) throw new Error('Draft has edits after migration; refusing destructive rollback');
    await atomicReplace(draftPath, original, manifest.candidateHash);
    return {status:'rolled-back', bundleDir:bundle, sourceHash:manifest.sourceHash};
  });
}
