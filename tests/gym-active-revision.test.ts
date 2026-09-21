import test from 'node:test';
import assert from 'node:assert/strict';
import {loadGymData} from '../src/gym/loadGymData';

test('Gym loads custom rows and matching anchor metadata only from the active pack',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  const root='characters/paint/assets/revisions/new/pack';
  const frame={file:'sprites/needle/needle_001.png',width:100,height:100,anchor:{x:50,y:90}};
  const activeMeta={frames:{needle:[frame]}},requests:string[]=[];
  const payloads:Record<string,unknown>={
    '/api/characters/paint/runtime-config':{assetRoot:root,config:{sprite:{frameCounts:{base:6,needle:1}}}},
    '/api/characters/paint/draft':{draft:{id:'paint',assets:{rootKey:root}}},
    '/api/characters/paint/assets':{assets:[
      {key:'characters/paint/assets/old/frameData.json',relativePath:'old/frameData.json',apiUrl:'/old-meta'},
      {key:'characters/paint/assets/old/sprites/needle/needle_001.png',relativePath:'old/'+frame.file,apiUrl:'/old-image'},
      {key:root+'/frameData.json',relativePath:'revisions/new/pack/frameData.json',apiUrl:'/new-meta'},
      {key:root+'/'+frame.file,relativePath:'revisions/new/pack/'+frame.file,apiUrl:'/new-image'},
    ]},'/new-meta':activeMeta,
  };
  globalThis.fetch=(async input=>{const url=String(input);requests.push(url);assert.ok(url in payloads,`Unexpected read ${url}`);return new Response(JSON.stringify(payloads[url]));}) as typeof fetch;
  const data=await loadGymData('paint');
  assert.deepEqual(Object.keys(data.frameUrls),['needle']);
  assert.deepEqual(data.frameUrls.needle,['/new-image']);
  assert.deepEqual(data.frameData,activeMeta);
  assert.equal(data.frameDataKey,root+'/frameData.json');
  assert.ok(!requests.includes('/old-meta'));
});
