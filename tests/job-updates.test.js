import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observeJob,watchJob} from '../admin/jobUpdates.js';
class Source extends EventTarget{
  static instances=[];
  constructor(url){super();this.url=url;Source.instances.push(this);}
  close(){this.closed=true;}
  job(job){this.dispatchEvent(new MessageEvent('job',{data:JSON.stringify({job})}));}
}
test('inline progress and activity share a stream until the last subscriber leaves',()=>{
  const count=Source.instances.length,first=[],second=[];
  const job={id:'shared',revision:0,status:'running'},options={url:'/jobs/shared',job,EventSourceClass:Source};
  const abort=new AbortController();
  const stopFirst=watchJob({...options,signal:abort.signal,onJob:job=>first.push(job.revision)});
  const stopSecond=watchJob({...options,onJob:job=>second.push(job.revision)});
  assert.equal(Source.instances.length,count+1);
  const source=Source.instances.at(-1);source.job({...job,revision:1});
  abort.abort();assert.equal(source.closed,undefined);
  source.job({...job,revision:2});stopSecond();stopFirst();
  assert.equal(source.closed,true);assert.deepEqual(first,[1]);assert.deepEqual(second,[1,2]);
  const stopNext=watchJob({...options,onJob:()=>{}});
  assert.equal(Source.instances.length,count+2);stopNext();
});
test('job revisions ignore duplicate/late events, terminal closes and disposal blocks callbacks',()=>{
  const updates=[];
  const stop=observeJob({url:'/jobs/test',job:{id:'test',revision:2,status:'running'},EventSourceClass:Source,onJob:job=>updates.push(job.status)});
  const source=Source.instances.at(-1);assert.match(source.url,/after=2/);
  source.job({id:'test',revision:2,status:'running'});
  source.job({id:'other',revision:3,status:'completed'});
  source.job({id:'test',revision:3,status:'extracting'});
  source.job({id:'test',revision:2,status:'running'});
  source.job({id:'test',revision:4,status:'completed'});
  source.job({id:'test',revision:5,status:'failed'});
  assert.deepEqual(updates,['extracting','completed']);assert.equal(source.closed,true);stop();
});
test('disconnected stream polls saved job and surfaces terminal failure without resubmission',async()=>{
  let polls=0;const updates=[];
  const stop=observeJob({url:'/jobs/test',job:{id:'test',revision:0,status:'running'},EventSourceClass:Source,
    fetchJob:async()=>{polls++;return {id:'test',revision:1,status:'submission-uncertain'};},onJob:job=>updates.push(job.status)});
  const source=Source.instances.at(-1);source.dispatchEvent(new Event('error'));
  await new Promise(resolve=>setTimeout(resolve,1300));
  assert.equal(polls,1);assert.deepEqual(updates,['submission-uncertain']);assert.equal(source.closed,true);stop();
});
