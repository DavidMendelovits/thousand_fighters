import type {FighterState} from '../schema/types';
export const CONTROL_BUCKETS=['hitstop','hitstun','stun','blockstun','grab','knockdown','actionable'] as const;
type Bucket=typeof CONTROL_BUCKETS[number];
export class ControlTelemetry {
  total=0;
  players=[this.empty(),this.empty()];
  private empty(){return {ticks:Object.fromEntries(CONTROL_BUCKETS.map(k=>[k,0])) as Record<Bucket,number>,currentLock:0,longestLock:0};}
  reset(){this.total=0;this.players=[this.empty(),this.empty()];}
  record(states: FighterState[],hitstop=false){
    this.total++;
    states.forEach((state,i)=>{
      const bucket:Bucket=hitstop?'hitstop':state==='stunned'?'stun':state==='hitstun'||state==='juggle'?'hitstun':state==='blockstun'?'blockstun':state==='grabbed'?'grab':state==='knockdown'||state==='getup'?'knockdown':'actionable';
      const p=this.players[i];p.ticks[bucket]++;p.currentLock=bucket==='actionable'?0:p.currentLock+1;p.longestLock=Math.max(p.longestLock,p.currentLock);
    });
  }
  snapshot(){return {totalTicks:this.total,seconds:this.total/60,players:this.players.map(p=>({...p,ticks:{...p.ticks},lockedPercent:this.total?100*(this.total-p.ticks.actionable)/this.total:0,longestLockMs:Math.round(p.longestLock*1000/60)}))};}
}
