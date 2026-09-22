import {ResourceScope} from './WorkbenchSession.js';
export const ACTIVE_JOB_STATES=new Set(['queued','running','preparing','submitting','provider-active','extracting']);

// A job can appear in both its inline progress and Build activity. Those views
// share one connection; the last subscriber leaving releases it immediately.
const subscriptions=new Map();
export function watchJob(options){
  const {url,job,signal,onJob,onError=()=>{}}=options;
  if(signal?.aborted)return ()=>{};
  let entry=subscriptions.get(url);
  if(!entry){
    entry={listeners:new Set(),latest:job,stop:()=>{}};
    subscriptions.set(url,entry);
    entry.stop=observeJob({...options,signal:undefined,onJob:next=>{
      entry.latest=next;
      for(const listener of [...entry.listeners])listener.onJob(next);
    },onError:error=>{for(const listener of [...entry.listeners])listener.onError(error);}});
  }
  const listener={onJob,onError};entry.listeners.add(listener);
  const stop=()=>{
    entry.listeners.delete(listener);signal?.removeEventListener('abort',stop);
    if(!entry.listeners.size){entry.stop();if(subscriptions.get(url)===entry)subscriptions.delete(url);}
  };
  signal?.addEventListener('abort',stop,{once:true});
  if((entry.latest.revision??-1)>(job.revision??-1))queueMicrotask(()=>{
    if(entry.listeners.has(listener))onJob(entry.latest);
  });
  return stop;
}

// SSE carries persisted revisions. Polling is the recovery path, never a POST.
export function observeJob({url,job,onJob,onError=()=>{},signal,EventSourceClass=globalThis.EventSource,fetchJob=async()=>{
  const response=await fetch(url,{signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(`Status unavailable (HTTP ${response.status})`);
  return (await response.json()).job;
}}){
  const scope=new ResourceScope();let revision=job.revision??-1,lastStatus=job.status,stream,timer,lastEvent=Date.now(),connected=false;
  const receive=next=>{
    if(scope.disposed||!next||next.id!==job.id)return;
    const nextRevision=next.revision??-1;
    if(nextRevision<revision||(nextRevision===revision&&next.status===lastStatus))return;
    revision=nextRevision;lastStatus=next.status;lastEvent=Date.now();onJob(next);
    if(!ACTIVE_JOB_STATES.has(next.status))scope.dispose();
  };
  const poll=async()=>{
    if(scope.disposed)return;
    if(!connected||Date.now()-lastEvent>15000){
      try{receive(await fetchJob());}catch(error){if(!scope.disposed)onError(error);}
    }
    if(!scope.disposed)timer=setTimeout(poll,globalThis.document?.hidden?10000:1200);
  };
  scope.own(()=>clearTimeout(timer));
  if(signal){if(signal.aborted){scope.dispose();return ()=>{};}scope.listen(signal,'abort',()=>scope.dispose(),{once:true});}
  if(EventSourceClass){
    stream=new EventSourceClass(`${url}/events?after=${encodeURIComponent(revision)}`);
    scope.own(()=>stream.close());
    scope.listen(stream,'open',()=>{connected=true;lastEvent=Date.now();});
    scope.listen(stream,'job',event=>{
      try{receive(JSON.parse(event.data).job);}catch(error){connected=false;onError(error);}
    });
    scope.listen(stream,'error',()=>{connected=false;});
  }
  timer=setTimeout(poll,1200);
  return ()=>scope.dispose();
}
