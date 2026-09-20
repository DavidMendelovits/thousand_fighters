import { randomUUID } from 'node:crypto';
import { digest, segment } from '../storage/LineageStore.js';
import { stableJson, loadReviewContext, motionFingerprint, motionReviewStatus } from '../pipeline/reviewFingerprint.js';
import {TrialRunner,trialExecutionBlock} from './TrialRunner.js';

const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const filtersAllowed = ['characterId', 'provider', 'model', 'kind', 'moveId', 'style', 'resolution', 'measurementKind', 'trialId'];
const timestamp = event => event.observedAt ?? event.completedAt ?? event.at ?? event.recordedAt ?? event.startedAt ?? '';
const terminal = new Set(['succeeded', 'failed', 'needs-recovery']);
const percentiles = values => {
  const sorted = values.filter(value => number(value) !== null).sort((a,b) => a-b);
  const quantile = q => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length*q)-1)] : null;
  return { samples: sorted.length, p50Ms: quantile(.5), p95Ms: quantile(.95) };
};

/** Canonical lifecycle events and legacy benchmark observations describe the
 * same billable attempt. They are observations, never separate purchases. */
export function deduplicateAttempts(observations) {
  const grouped = new Map();
  for (const observation of observations) {
    if (!observation.attemptId) continue;
    const values = grouped.get(observation.attemptId) ?? [];
    values.push(observation); grouped.set(observation.attemptId, values);
  }
  return [...grouped.values()].map(values => {
    values.sort((a,b) => timestamp(a).localeCompare(timestamp(b)) || (a._canonical ? 1 : 0)-(b._canonical ? 1 : 0));
    const canonical = values.filter(value => value._canonical).sort((a,b) => Number.isInteger(a.revision) && Number.isInteger(b.revision) ? a.revision-b.revision : timestamp(a).localeCompare(timestamp(b)));
    const merged = Object.assign({}, ...values);
    // A late legacy duplicate must not erase canonical recovery state.
    if (canonical.length) merged.status = canonical.at(-1).status ?? merged.status;
    // Recovery observations may have no new timing/price. Preserve the last
    // measured value, never manufacture an end-to-end resumed duration.
    for (const key of ['durationMs','estimatedCostUsd']) {
      merged[key] = values.filter(value => number(value[key]) !== null).at(-1)?.[key] ?? null;
    }
    for(const key of ['characterId','moveId','style','resolution','buildJobId','trialId','trialSlot','comparisonHash']){
      merged[key]=values.filter(value=>value[key]!=null).at(-1)?.[key]??null;
    }
    merged.stageTimings = Object.assign({}, ...values.map(value => value.stageTimings ?? {}));
    merged.observations = values.length;
    merged.measurementKind ??= 'unclassified';
    merged.estimatedCostUsd = number(merged.estimatedCostUsd);
    merged.durationMs = terminal.has(merged.status) ? number(merged.durationMs) : null;
    delete merged._canonical;
    return merged;
  });
}

export function summarizeAttempts(attempts) {
  const known = attempts.filter(attempt => attempt.estimatedCostUsd !== null);
  const stageKeys = [...new Set(attempts.flatMap(attempt => Object.keys(attempt.stageTimings ?? {})))].filter(key => key.endsWith('Ms')).sort();
  return {
    attempts: attempts.length,
    succeeded: attempts.filter(attempt => attempt.status === 'succeeded').length,
    failed: attempts.filter(attempt => attempt.status === 'failed').length,
    unresolved: attempts.filter(attempt => !['succeeded','failed'].includes(attempt.status)).length,
    retries: attempts.filter(attempt => number(attempt.attemptNumber) > 1).length,
    retryMetadataMissing: attempts.filter(attempt => number(attempt.attemptNumber) === null).length,
    duration: percentiles(attempts.map(attempt => attempt.durationMs)),
    successfulDuration: percentiles(attempts.filter(attempt => attempt.status === 'succeeded').map(attempt => attempt.durationMs)),
    stages: Object.fromEntries(stageKeys.map(key => [key,percentiles(attempts.map(attempt => attempt.stageTimings?.[key]))])),
    cost: { knownSubtotalUsd: known.reduce((sum,attempt) => sum+attempt.estimatedCostUsd,0), knownAttempts: known.length, unknownAttempts: attempts.length-known.length, complete: known.length === attempts.length, kind: 'estimate' },
  };
}

async function readJsonObjects(storage, prefix, warnings) {
  const keys = (await storage.list(prefix)).filter(key => key.endsWith('.json') && !key.endsWith('.meta.json')).sort();
  const result = [];
  // Bound object-store fan-out; malformed historic records don't erase good data.
  for (let offset = 0; offset < keys.length; offset += 16) {
    const batch = await Promise.allSettled(keys.slice(offset, offset+16).map(async key => ({key, value: await storage.getJson(key)})));
    for (const item of batch) {
      if (item.status === 'fulfilled') result.push(item.value);
      else warnings.push('One saved record could not be read; totals are incomplete.');
    }
  }
  return result;
}

export class BenchmarkService {
  constructor({storage, repository, trialTransport, trialRootDir}) { this.storage = storage; this.repository = repository; this.trialRunner=new TrialRunner({storage,transport:trialTransport,rootDir:trialRootDir}); }

  async report(filters = {}) {
    const warnings = [];
    const [legacy, ledger, jobRecords] = await Promise.all([
      readJsonObjects(this.storage, 'benchmarks/generation-attempts', warnings),
      readJsonObjects(this.storage, 'generation-attempts', warnings),
      readJsonObjects(this.storage, 'build-jobs', warnings),
    ]);
    const observations = [...legacy.map(({value}) => value), ...ledger.filter(({key}) => /\/(intent\.json|events\/[^/]+\.json)$/.test(key)).map(({value}) => ({...value, _canonical:true}))];
    const all = deduplicateAttempts(observations);
    const selected = all.filter(attempt => filtersAllowed.every(key => !filters[key] || String(attempt[key] ?? '') === String(filters[key])));
    const byGroup = new Map();
    for (const attempt of selected) {
      const identity = Object.fromEntries(['measurementKind','provider','model','kind','moveId','style','resolution'].map(key => [key, attempt[key] ?? null]));
      const key = stableJson(identity);
      if (!byGroup.has(key)) byGroup.set(key, {identity,attempts:[]});
      byGroup.get(key).attempts.push(attempt);
    }
    const jobs = new Map();
    for (const {key,value} of jobRecords) {
      const match = key.match(/^build-jobs\/([^/]+)\/([^/]+)\/(?:request\.json|events\/[^/]+\.json)$/);
      if (!match) continue;
      const id = match[2], previous = jobs.get(id) ?? {id,characterId:match[1]};
      jobs.set(id, {...previous,...value});
    }
    const selectedIds = new Set(selected.map(attempt => attempt.buildJobId).filter(Boolean));
    const relevantJobs = [...jobs.values()].filter(job => selectedIds.has(job.id));
    const reviews = await this.reviewOutcomes(selected, warnings);
    const summary = summarizeAttempts(selected);
    return {
      generatedAt: new Date().toISOString(), filters: Object.fromEntries(filtersAllowed.filter(key => filters[key]).map(key => [key,filters[key]])),
      summary, groups: [...byGroup.values()].map(group => ({...group.identity,...summarizeAttempts(group.attempts)})),
      inventory: selected.map(attempt => Object.fromEntries(['attemptId','status','characterId','moveId','provider','model','kind','measurementKind','style','resolution','startedAt','completedAt','durationMs','estimatedCostUsd','attemptNumber','buildJobId','providerTaskId','observations','stageTimings','trialId','trialSlot','comparisonHash'].map(key => [key,attempt[key]??null]))),
      cohort: {
        knownRecordedEstimateUsd:summary.cost.knownSubtotalUsd, unknownPrices:summary.cost.unknownAttempts,
        currentAcceptedRows:reviews.acceptedRows,
        recordedEstimatePerCurrentAcceptedRowUsd:reviews.acceptedRows && summary.cost.complete ? summary.cost.knownSubtotalUsd/reviews.acceptedRows : null,
        interpretation:'Descriptive ratio across the selected recorded cohort, including failed and discarded attempts. Not a causal or complete lifetime creation cost; missing historical attempts cannot be reconstructed.',
      },
      facets: Object.fromEntries(filtersAllowed.map(key => [key,[...new Set(all.map(attempt => attempt[key]).filter(value => value != null).map(String))].sort()])),
      jobs: { matched: relevantJobs.length, extraction: percentiles(relevantJobs.map(job => job.extractionMs)), execution: percentiles(relevantJobs.map(job => job.executionMs)) },
      reviews, warnings: [...new Set(warnings)],
      limitations: [
        'Prices are provider estimates, not reconciled invoices. Unknown prices are never counted as free.',
        'Latency percentiles use recorded terminal attempts only; unresolved requests and missing timings are excluded.',
        'Recovered attempts retain the last measured active duration when no replacement timing exists; this is not time spent waiting for operator recovery.',
        'Legacy unclassified measurements are not evidence of live-provider performance. Fixture and provider groups remain separate.',
        'Review attribution requires a matching source hash and a current version-bound review. Character-wide accepted cost is unavailable without complete provenance.',
      ],
    };
  }

  async reviewOutcomes(attempts, warnings) {
    const output = { acceptedRows:0, rejectedRows:0, pendingRows:0, attributedAttempts:0, acceptedOutputKnownCostUsd:0, acceptedOutputsWithCompleteCost:0, meanAcceptedOutputAttemptCostUsd:null, costPerAcceptedRowUsd:null, costPerAcceptedCharacterUsd:null };
    if (!this.repository) return output;
    for (const characterId of new Set(attempts.map(attempt => attempt.characterId).filter(Boolean))) {
      try {
        const context = await loadReviewContext(this.repository,characterId);
        for (const [action,report] of Object.entries(context.draft.motionRows ?? {})) {
          const matched = attempts.filter(attempt => attempt.characterId === characterId && attempt.moveId === action && report.sourceSha256 && (attempt.outputArtifact?.sha256 === report.sourceSha256 || attempt.sourceSha256 === report.sourceSha256));
          if (!matched.length) continue;
          const {fingerprint,missing} = await motionFingerprint(context,action);
          const status = motionReviewStatus(report,fingerprint,missing);
          output.attributedAttempts += matched.length;
          if (status === 'approved') {
            output.acceptedRows++;
            if (matched.every(attempt => attempt.estimatedCostUsd !== null)) {
              output.acceptedOutputsWithCompleteCost++;
              output.acceptedOutputKnownCostUsd += matched.reduce((sum,attempt) => sum+attempt.estimatedCostUsd,0);
            }
          } else if (['changes-requested','rejected'].includes(status)) output.rejectedRows++;
          else output.pendingRows++;
        }
      } catch { warnings.push('Some current row reviews could not be verified; review totals are incomplete.'); }
    }
    output.meanAcceptedOutputAttemptCostUsd = output.acceptedOutputsWithCompleteCost ? output.acceptedOutputKnownCostUsd/output.acceptedOutputsWithCompleteCost : null;
    return output;
  }

  async createTrial(input) {
    const name = String(input.name ?? '').trim();
    const characterId = segment(input.characterId);
    if (!name || name.length > 120) throw new Error('Trial name must be 1–120 characters.');
    if (!Array.isArray(input.candidates) || input.candidates.length < 2 || input.candidates.length > 8) throw new Error('Choose 2–8 provider/model candidates.');
    const candidates = input.candidates.map((candidate,index) => {
      if (![candidate.provider,candidate.model].every(value => typeof value === 'string' && /^[\w./:-]{1,160}$/.test(value))) throw new Error('Each candidate needs a provider and model identifier.');
      return { label:`Candidate ${index+1}`,provider:candidate.provider,model:candidate.model };
    });
    if (new Set(candidates.map(candidate => `${candidate.provider}:${candidate.model}`)).size !== candidates.length) throw new Error('Candidates must be distinct.');
    if (!Array.isArray(input.actions) || !input.actions.length || input.actions.length > 12) throw new Error('Choose 1–12 representative actions.');
    const actions = input.actions.map(action => {
      const moveId = segment(action.moveId), prompt = String(action.prompt ?? '').trim();
      if (!prompt || prompt.length > 16000) throw new Error('Every action needs an identical comparison prompt.');
      return {moveId,prompt};
    });
    if (new Set(actions.map(action => action.moveId)).size !== actions.length) throw new Error('Actions must be distinct.');
    if (!Array.isArray(input.referenceKeys) || !input.referenceKeys.length || input.referenceKeys.length > 8) throw new Error('Pin 1–8 reference assets.');
    const references = [];
    for (const key of input.referenceKeys) {
      if (typeof key !== 'string' || !key.startsWith(`characters/${characterId}/assets/`) || key.includes('..') || key.includes('\\')) throw new Error('References must be character assets.');
      const bytes = await this.storage.getBytes(key);
      if (!this.storage.lineage) throw new Error('Immutable asset archival is required for trials.');
      const artifact = await this.storage.lineage.artifact(bytes,await this.storage.getMetadata(key));
      references.push({sourceKey:key,...artifact});
    }
    const budgetUsd = number(input.budgetUsd);
    if (budgetUsd === null || budgetUsd <= 0 || budgetUsd > 1000) throw new Error('Set an explicit trial budget greater than zero and at most $1,000.');
    const settings = {};
    for (const key of ['resolution','durationSeconds','seed','artStyle']) {
      const value = input.settings?.[key];
      if (value != null) {
        if (!['string','number'].includes(typeof value) || String(value).length > 200 || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Invalid trial setting.');
        settings[key] = value;
      }
    }
    if (!settings.resolution || !settings.durationSeconds || !settings.artStyle) throw new Error('Pin resolution, durationSeconds and artStyle to compare like-for-like motion.');
    if (typeof settings.durationSeconds !== 'number' || settings.durationSeconds <= 0 || settings.durationSeconds > 30) throw new Error('Trial duration must be 0–30 seconds.');
    const definition = {schemaVersion:1,id:randomUUID(),name,characterId,createdAt:new Date().toISOString(),references,actions,candidates,settings,budgetUsd,
      status:'saved-not-submitted',executionBlockedReason:'Current build jobs cannot pin arbitrary provider/model settings. No API calls or budget charges were made.',
      criteria:['identity consistency','motion readability','nonhuman deformation','frame clipping','contact and recovery'],
      comparisonHash:digest(Buffer.from(stableJson({references:references.map(ref => ref.sha256),actions,settings}))),
    };
    await this.storage.putImmutable(`benchmarks/trials/${definition.id}.json`,Buffer.from(JSON.stringify(definition,null,2)),{contentType:'application/json'});
    return {...definition,executionBlockedReason:trialExecutionBlock(definition),runs:[]};
  }

  async listTrials() { return Promise.all((await readJsonObjects(this.storage,'benchmarks/trials',[])).map(({value}) => value).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(value=>this.getTrial(value.id))); }
  async getTrial(id) { const trial=await this.storage.getJson(`benchmarks/trials/${segment(id)}.json`);return {...trial,executionBlockedReason:trialExecutionBlock(trial),runs:await this.trialRunner.states(trial)}; }
  async runTrial(id,input) { return this.trialRunner.admit(await this.getTrial(id),input); }
  async resumeTrial(id,input) { return this.trialRunner.admit(await this.getTrial(id),input,{resume:true}); }
}
