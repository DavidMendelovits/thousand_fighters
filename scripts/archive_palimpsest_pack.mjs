import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createCmsStorage} from '../cms/storage/createCmsStorage.js';
import {CharacterContentRepository} from '../cms/repositories/CharacterContentRepository.js';
const storage=createCmsStorage(),repo=new CharacterContentRepository(storage);
const plan=JSON.parse(await readFile('docs/palimpsest-reviewed-motion.json','utf8'));
const root='public/fighters/palimpsest',draft=await repo.getDraft('palimpsest'),pack=draft.assets.rootKey;
await storage.lineage.run({characterId:'palimpsest',stage:'paint-pack-provenance'},async()=>{
 const references='/tmp/codex-remote-attachments/01a05f07-2dda-7871-8a92-349d3d01cc28/1C6CD567-1F29-4F1C-B4D3-79E8CC3681CF';
 for(const n of [1,2,3])await storage.lineage.event('palimpsest',{type:'user-reference',name:`painting-${n}`,role:n===1?'needle hands':'creature palette and liquid form',artifact:await storage.lineage.artifact(await readFile(`${references}/${n}-Photo-${n}.jpg`),{contentType:'image/jpeg'})});
 for(const kind of ['body','hands'])for(const v of [1,2]){
  const request=JSON.parse(await readFile(`generated/palimpsest/${kind}-v${v}/request.json`,'utf8'));
  await storage.lineage.event('palimpsest',{type:'image-generation-request',kind,version:v,request});
 }
 const manifest=JSON.parse(await readFile(`${root}/manifest.json`,'utf8'));
 for(const [action,selection] of Object.entries(plan)){
  const dir=selection.directory??`generated/palimpsest/motion-v3/${action}`;
  for(const [source,file] of [['sheet.png',`sheets/${action}.png`],['preview.png',`motion/${action}/preview.png`],['contact.png',`motion/${action}/contact.png`]]){
   await mkdir(`${root}/${file.substring(0,file.lastIndexOf('/'))}`,{recursive:true});await copyFile(`${dir}/${source}`,`${root}/${file}`);
   await storage.putBytes(`${pack}/${file}`,await readFile(`${dir}/${source}`),{contentType:'image/png'});
  }
  manifest.sheets[action]=`sheets/${action}.png`;
 }
 await writeFile(`${root}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');await storage.putJson(`${pack}/manifest.json`,manifest);
 const config=JSON.parse(await readFile(`${root}/config.json`,'utf8'));
 for(const [file,text] of Object.entries({'description.txt':config.concept.biography,'moveset.txt':config.moves.map(m=>`${m.displayName} — ${m.inputLabel}\n${m.description}`).join('\n\n')})){
  await writeFile(`${root}/${file}`,text+'\n');await storage.putBytes(`${pack}/${file}`,Buffer.from(text+'\n'),{contentType:'text/plain'});
 }
 const version=await repo.createVersion('palimpsest',draft,{label:'Complete reviewed paint pack with source paintings, sheets and previews'});
 console.log(JSON.stringify({versionId:version.versionId,assetCount:version.history.assetCount}));
});
