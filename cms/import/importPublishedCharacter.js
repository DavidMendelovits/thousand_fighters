import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {normalizeManifest} from '../pipeline/manifestSchema.js';
const exec=promisify(execFile);
const movement=['walkForwardSpeed','walkBackSpeed','jumpVelocity','jumpForwardVelocity','jumpBackVelocity','gravity','maxFallSpeed','maxHealth'];

/** Scoped, non-overwriting migration. No model call and no published file changes. */
export async function importPublishedCharacter({characterId,repository,fightersRoot=path.resolve('public/fighters')}) {
  if(!/^[a-z][a-z0-9_]*$/.test(characterId))throw new Error('Use a published fighter id (lowercase letters, numbers, underscores).');
  if(await repository.storage.exists(repository.draftKey(characterId)))throw new Error('This fighter already has a draft. Open it instead; import never overwrites drafts.');
  const root=path.join(fightersRoot,characterId);
  const json=async file=>JSON.parse(await readFile(path.join(root,file),'utf8'));
  const config=await json('config.json'),frames=await json('frameData.json'),manifest=normalizeManifest(await json('manifest.json'));
  if(config.id!==characterId||config.actors?.length)throw new Error('Import requires a matching single-actor published config.');
  const base=frames.frames?.base;
  if(!base?.length)throw new Error('Published fighter needs an extracted base row.');
  const safeFile=file=>{const p=path.resolve(root,file);if(!p.startsWith(root+path.sep))throw new Error('Unsafe asset path');return p;};
  // Measure existing alpha without changing any pixels. New rows use this
  // reference height, not the arbitrary size of a video capture canvas.
  const {stdout}=await exec('python3',['-c','import sys,json; from PIL import Image; print(json.dumps([Image.open(p).convert("RGBA").getchannel("A").getbbox() for p in sys.argv[1:]]))',...base.map(f=>safeFile(f.file))]);
  const boxes=JSON.parse(stdout);
  base.forEach((f,i)=>{if(boxes[i])f.silhouetteHeight=boxes[i][3]-boxes[i][1];});
  const copy=async(dir,prefix='')=>{for(const e of await readdir(dir,{withFileTypes:true})){const rel=prefix+e.name;if(e.isDirectory())await copy(path.join(dir,e.name),rel+'/');else if(e.isFile()&&!['config.json','frameData.json','manifest.json'].includes(rel))await repository.writeAsset(characterId,`fighter-pack/${rel}`,await readFile(path.join(dir,e.name)),{source:'published-runtime-import'});}};
  await copy(root);
  await repository.writeAsset(characterId,'fighter-pack/frameData.json',Buffer.from(JSON.stringify(frames)),{contentType:'application/json'});
  await repository.writeAsset(characterId,'fighter-pack/manifest.json',Buffer.from(JSON.stringify(manifest)),{contentType:'application/json'});
  await repository.writeAsset(characterId,'fighter-pack/sprites/base/base_001.png',await readFile(safeFile(base[0].file)),{source:'published-reference-alias',contentType:'image/png'});
  return repository.saveDraft(characterId,{
    schemaVersion:1,id:characterId,displayName:config.displayName,description:config.concept?.biography??config.displayName,
    rosterGroup:config.rosterGroup,concept:config.concept,pushboxWidth:config.pushboxWidth,
    stats:Object.fromEntries(movement.map(k=>[k,config[k]]).filter(([,v])=>v!==undefined)),combatStats:config.stats??{},
    geometryMode:'authored-runtime',hurtboxes:config.hurtboxes,guardboxes:config.guardboxes,
    sprite:{...config.sprite,scaleMode:'authored-reference'},animations:config.animations,
    moves:config.moves,forms:config.forms??[],powerUps:config.powerUps??[],
    source:{type:'published-runtime',publicPath:`/fighters/${characterId}`,importedAt:new Date().toISOString()},
  },{provider:'published-runtime-import'});
}
