import test from 'node:test';
import assert from 'node:assert/strict';
import {characterContentDraftGuidance,comboAuthoringGuidance} from '../cms/pipeline/adapters/characterContentDraftSchema.js';
for(const [name,guidance]of [['character',characterContentDraftGuidance],['combo',comboAuthoringGuidance]])test(`${name} prompts use character-specific, reachable inputs`,()=>{
 const text=guidance().join('\n');
 assert.match(text,/CHARACTER-SPECIFIC/);assert.match(text,/three-button mobile/);assert.match(text,/aliases are NOT distinct/);assert.match(text,/predecessor/);assert.match(text,/explicit user control preferences/);
});
