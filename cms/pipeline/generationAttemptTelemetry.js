import { randomUUID } from 'node:crypto';
import { createCmsStorage } from '../storage/createCmsStorage.js';
import { currentLineage, safeProvenance } from '../storage/LineageStore.js';
import { GenerationAttemptLedger } from './GenerationAttemptLedger.js';

/**
 * Wrap one external, potentially billable generation attempt. The caller's
 * benchmark recorder remains best-effort. The independent durable ledger fails
 * closed before submission and preserves ambiguous acceptance for recovery.
 */
export async function runGenerationAttempt(request, metadata, operation) {
  const lineage = request.onGenerationAttempt?.lineage ?? currentLineage() ?? createCmsStorage().lineage;
  const identity = attemptIdentity(request, metadata);
  const references = [];
  for (const ref of request.referenceImages ?? []) {
    const bytes = ref.bytes ?? (ref.base64 ? Buffer.from(ref.base64, 'base64') : null);
    if (bytes) references.push(await lineage.artifact(bytes, { contentType: ref.contentType ?? 'image/png' }));
  }
  return lineage.run({ characterId: identity.characterId, stage: 'external-generation', inputs: { ...safeProvenance(request), references }, provider: identity.provider, model: identity.model }, async () => {
    const result = await measuredAttempt(request, metadata, operation, lineage);
    // Archive individual frame attempts, not only the final assembled sheet.
    // An archival failure is not retryable as a provider/network failure.
    try {
      const bytes = result?.bytes ?? (result?.base64 ? Buffer.from(result.base64, 'base64') : null);
      if (bytes) await lineage.event(identity.characterId, { type: 'generation-output', attemptId: result.generationAttemptId, artifact: await lineage.artifact(bytes, { contentType: result.contentType }), provider: identity.provider, model: identity.model, providerTaskId: result.taskId ?? null, references });
      if (result?.videoBytes) await lineage.event(identity.characterId, { type: 'generation-output', attemptId: result.generationAttemptId, artifact: await lineage.artifact(result.videoBytes, { contentType: 'video/mp4' }), references });
    } catch (cause) {
      const error = new Error('Provider completed but archival failed. Do not regenerate automatically; recover the provider result.', { cause });
      error.name = 'ArchivePersistenceError';
      error.noRetry = true;
      throw error;
    }
    return result;
  });
}

async function measuredAttempt(request, metadata, operation, lineage) {
  const now = metadata.now ?? Date.now;
  const startedMs = now();
  const startedAt = new Date().toISOString();
  const attemptId = metadata.attemptId ?? randomUUID();
  const ledger=new GenerationAttemptLedger(lineage);
  const identity={...attemptIdentity(request,metadata),attemptId,startedAt};
  // Fail closed before crossing the external API boundary.
  try { await ledger.intent({...identity,inputs:safeProvenance(request)}); }
  catch(error){error.noRetry=true;throw error;}
  let providerTaskId=null;
  request.generationCheckpoint=async details=>{
    providerTaskId=details.providerTaskId??providerTaskId;
    await ledger.event({...identity,...details,providerTaskId});
  };
  try {
    const result = await operation();
    const completedMs = now();
    const bytes=result?.bytes??(result?.base64?Buffer.from(result.base64,'base64'):null);
    const outputArtifact=bytes?await lineage.artifact(bytes,{contentType:result.contentType}):null;
    const videoArtifact=result?.videoBytes?await lineage.artifact(result.videoBytes,{contentType:'video/mp4'}):null;
    const event={
      schemaVersion: 1,
      attemptId,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: completedMs - startedMs,
      status: 'succeeded',
      ...attemptIdentity(request, metadata),
      providerTaskId: result?.taskId ?? result?.promptRef ?? providerTaskId,
      stageTimings: result?.stageTimings ?? null,
      usage: result?.usage ?? null,
      estimatedCostUsd: finiteOrNull(result?.estimatedCostUsd),
      outputArtifact,videoArtifact,
    };
    await ledger.event(event);
    await emitAttempt(request,event);
    if (result && typeof result === 'object' && !result.generationAttemptId) result.generationAttemptId = attemptId;
    return result;
  } catch (error) {
    // Transport failures are not proof of non-acceptance. Disable the adapter's
    // old transient-error retry loop, including timeout and lost response cases.
    error.noRetry=error.noRetry||Boolean(providerTaskId)||error.statusCode!==429;error.attemptId=attemptId;error.taskId??=providerTaskId;
    const completedMs = now();
    const event={
      schemaVersion: 1,
      attemptId,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: completedMs - startedMs,
      status: 'failed',
      ...attemptIdentity(request, metadata),
      providerTaskId: error?.taskId ?? null,
      stageTimings: error?.stageTimings ?? null,
      estimatedCostUsd: finiteOrNull(error?.estimatedCostUsd),
      error: {
        name: safeText(error?.name, 80) || 'Error',
        statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : null,
        message: safeText(error?.message, 500) || 'Generation attempt failed.',
      },
    };
    try{await ledger.event({...event,status:'needs-recovery'});}catch{ /* durable intent remains unresolved */ }
    await emitAttempt(request,event);
    throw error;
  }
}

export async function emitAttempt(request, event) {
  if (typeof request?.onGenerationAttempt !== 'function') return;
  try {
    await request.onGenerationAttempt(event);
  } catch (error) {
    request.onProgress?.({
      type: 'warning',
      stage: 'benchmark-persistence',
      message: `Generation completed, but benchmark persistence failed: ${safeText(error?.message, 180)}`,
    });
  }
}

function attemptIdentity(request, metadata) {
  return {
    kind: metadata.kind ?? 'image',
    provider: metadata.provider ?? 'unknown',
    model: metadata.model ?? null,
    operation: metadata.operation ?? request?.task ?? 'generation',
    characterId: metadata.characterId ?? request?.context?.characterId ?? null,
    arenaId: metadata.arenaId ?? request?.context?.arenaId ?? null,
    moveId: metadata.moveId ?? request?.moveId ?? null,
    projectileId: metadata.projectileId ?? request?.projectileId ?? null,
    frameNumber: metadata.frameNumber ?? request?.frameNumber ?? null,
    attemptNumber: metadata.attemptNumber ?? request?.attemptNumber ?? 1,
    referenceCount: request?.referenceImages?.length ?? null,
    buildJobId:request?.context?.buildJobId??null,
    style:request?.context?.artStyle??null,
    resolution:request?.resolution??metadata.resolution??null,
    measurementKind:metadata.measurementKind??request?.context?.measurementKind??'provider',
  };
}

function finiteOrNull(value) {
  if(value===null||value===undefined||value==='')return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function safeText(value, limit) {
  return String(value ?? '')
    .replace(/\b(?:Bearer|Key)\s+\S+/gi, '[AUTH]')
    .replace(/data:[^\s"']+/gi, '[MEDIA]')
    .replace(/https?:[^\s"']+/gi, '[URL]')
    .replace(/[A-Za-z0-9+/=_-]{80,}/g, '[DATA]')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .slice(0, limit);
}
