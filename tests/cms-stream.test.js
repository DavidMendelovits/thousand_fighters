import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createCmsServer} from '../cms/server/createCmsServer.js';

async function streamFixture(t,invoke){
  const server=createCmsServer({runtime:{tools:{invoke}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  return `http://127.0.0.1:${server.address().port}/api/tools/test?stream`;
}

test('SSE remains open after POST body ends and delivers delayed progress and result',async t=>{
  const url=await streamFixture(t,async(name,input)=>{
    await delay(20);
    input.context.onProgress({type:'status',message:'Provider accepted; still working'});
    await delay(20);
    return {jobId:'fixture-only',framesReady:true};
  });
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({characterId:'fixture'})});
  assert.equal(response.status,200);
  const body=await response.text();
  assert.match(body,/event: progress/);
  assert.match(body,/Provider accepted/);
  assert.match(body,/event: result/);
  assert.match(body,/fixture-only/);
});

test('SSE returns a delayed provider error rather than an empty successful stream',async t=>{
  const url=await streamFixture(t,async()=>{await delay(20);throw new Error('Controlled provider rejection');});
  const body=await (await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).text();
  assert.match(body,/event: error/);
  assert.match(body,/Controlled provider rejection/);
});
