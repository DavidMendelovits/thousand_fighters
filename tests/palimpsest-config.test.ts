import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPalimpsest} from '../src/characters/palimpsest';
import {convertDraftToCharacterConfig} from '../cms/export/convertDraftToCharacterConfig.js';
import {validateCombatRules} from '../cms/export/validateCombatRules.js';
import {characterArtDirection} from '../cms/pipeline/adapters/pixelArtDirection.js';
test('CMS roundtrip preserves summon control payload, actor hitbox and character-specific inputs',()=>{
 const c=createPalimpsest();const draft={...c,geometryMode:'authored-runtime',actors:[{id:'lead'},{id:'hands',summon:true}],stats:{},sprite:{scale:.5}};
 const result=convertDraftToCharacterConfig({draft,frameData:null,manifest:null});
 const events=(id:string)=>result.moves.find((m:any)=>m.id===id).phases.flatMap((p:any)=>p.events.map((e:any)=>e.event));
 assert.deepEqual(events('summon').find((e:any)=>e.type==='summon_control'),{type:'summon_control',actor:'hands',duration:240,speed:4.1,offsetX:85,offsetY:-35});
 assert.equal(events('needle_thrust').find((e:any)=>e.type==='hitbox_active').actor,'hands');
 assert.deepEqual(events('hands_pinch').find((e:any)=>e.type==='grab_check').grab.actorGrip,{actor:'hands',socketX:0,socketY:-48,lift:36,swing:16});
 assert.equal(result.moves.find((m:any)=>m.id==='needle_thrust').controlledActor,'hands');
 assert.deepEqual(result.moves.find((m:any)=>m.id==='summon').trigger.directions,['down','down-forward','down-back']);
 assert.throws(()=>validateCombatRules({...draft,actors:[]}),/configured/);
 assert.match(characterArtDirection('paint'),/acrylic/);
});
