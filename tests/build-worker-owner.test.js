import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {BuildWorkerOwner} from '../cms/jobs/BuildWorkerOwner.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('simultaneous stale-record takeover elects exactly one owner without unlinking its inode',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'tf-worker-lock-')),lockPath=path.join(directory,'worker.lock');
  await writeFile(lockPath,JSON.stringify({pid:2147483647,token:'dead-worker'}));
  const inode=(await stat(lockPath)).ino;
  const owners=Array.from({length:8},()=>new BuildWorkerOwner({rootDir:directory},lockPath));
  t.after(async()=>{await Promise.all(owners.map(owner=>owner.release()));await rm(directory,{recursive:true,force:true});});
  const outcomes=await Promise.allSettled(owners.map(owner=>owner.acquire()));
  assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
  const winner=owners[outcomes.findIndex(result=>result.status==='fulfilled')];
  assert.equal(JSON.parse(await readFile(lockPath,'utf8')).token,winner.token);
  assert.equal((await stat(lockPath)).ino,inode);
  await winner.release();
  const next=owners.find(owner=>owner!==winner);await next.acquire();
  assert.equal((await stat(lockPath)).ino,inode);assert.equal(JSON.parse(await readFile(lockPath,'utf8')).token,next.token);
});

test('loss of ownership helper terminates its Node owner before further work',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'tf-worker-loss-')),lockPath=path.join(directory,'worker.lock');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const moduleUrl=new URL('../cms/jobs/BuildWorkerOwner.js',import.meta.url).href;
  const code=`import {BuildWorkerOwner} from ${JSON.stringify(moduleUrl)};
    const owner=new BuildWorkerOwner({},${JSON.stringify(lockPath)});
    await owner.acquire();owner.child.kill('SIGKILL');
    setTimeout(()=>console.log('UNSAFE_CONTINUATION'),500);`;
  await assert.rejects(promisify(execFile)(process.execPath,['--input-type=module','-e',code]),error=>{
    assert.equal(error.code,70);assert.doesNotMatch(error.stdout,/UNSAFE_CONTINUATION/);assert.match(error.stderr,/ownership was lost/);return true;
  });
  const replacement=new BuildWorkerOwner({},lockPath);await replacement.acquire();await replacement.release();
});

test('upgrade respects a live owner using the previous exclusive-file protocol',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'tf-worker-upgrade-')),lockPath=path.join(directory,'worker.lock');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(lockPath,JSON.stringify({pid:process.pid,token:'legacy-live-worker'}));
  const owner=new BuildWorkerOwner({},lockPath);t.after(()=>owner.release());
  await assert.rejects(owner.acquire(),/Another build worker/);
  assert.equal(JSON.parse(await readFile(lockPath,'utf8')).token,'legacy-live-worker');
});
