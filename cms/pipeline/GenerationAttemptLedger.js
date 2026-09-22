import {segment,safeProvenance} from '../storage/LineageStore.js';
import {observeBuildAttempt} from '../jobs/buildExecutionContext.js';

/** Durable facts, not a retry queue. A missing accepted event is uncertainty,
 * never evidence that a provider did not charge for a request. */
export class GenerationAttemptLedger {
  constructor(lineage){this.lineage=lineage;this.storage=lineage.storage;}
  root(id){return `generation-attempts/${segment(id)}`;}
  async intent(record){
    await this.lineage.immutable(`${this.root(record.attemptId)}/intent.json`,Buffer.from(JSON.stringify(safeProvenance({...record,schemaVersion:1,status:'intent'}))),{contentType:'application/json'});
    if(record.characterId&&record.buildJobId){
      // Written before submission. Recovery never scans the global attempt log.
      await this.lineage.immutable(`build-attempts/${segment(record.characterId)}/${segment(record.buildJobId)}/${segment(record.attemptId)}.json`,Buffer.from(JSON.stringify({attemptId:record.attemptId})),{contentType:'application/json'});
    }
    await observeBuildAttempt({...record,status:'intent'});
  }
  async event(record){
    const root=`${this.root(record.attemptId)}/events`;
    const keys=await this.storage.list(root);
    const records=await Promise.all(keys.map(key=>this.storage.getJson(key)));
    const revision=Math.max(-1,...records.map(event=>Number.isInteger(event.revision)?event.revision:-1))+1;
    const event=safeProvenance({...record,schemaVersion:1,revision,observedAt:new Date().toISOString()});
    // Atomic create-only revision is also the concurrency guard: a competing
    // worker cannot silently overwrite or ambiguously order a transition.
    await this.lineage.immutable(`${root}/${String(revision).padStart(12,'0')}.json`,Buffer.from(JSON.stringify(event)),{contentType:'application/json'});
    await observeBuildAttempt(event);
    return event;
  }
  async read(id){
    const intent=await this.storage.getJson(`${this.root(id)}/intent.json`);
    const keys=await this.storage.list(`${this.root(id)}/events`);
    const events=await Promise.all(keys.sort().map(key=>this.storage.getJson(key)));
    return {intent,events};
  }
}
