import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sha256,submissionNonce} from '../admin/submissionKey.js';

test('portable submission hashes exactly preserve existing SHA-256 storage keys',()=>{
  for(const value of ['', 'abc', 'paint 🎨', 'x'.repeat(55),'x'.repeat(56),'x'.repeat(64),'x'.repeat(10000),JSON.stringify({tool:'generate_sprite_sheet',input:{characterId:'palimpsest',prompt:'A painted ribbon'}})]){
    assert.equal(sha256(value),createHash('sha256').update(value).digest('hex'));
  }
});
test('nonce uses getRandomValues, not secure-context-only randomUUID',()=>{
  const values=new Set(Array.from({length:100},submissionNonce));assert.equal(values.size,100);
  for(const id of values)assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});
