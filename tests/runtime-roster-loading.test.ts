import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCmsRoster, roster } from '../src/characters/roster';

const hash = (value: string) => value.repeat(64).slice(0, 64);

test('web roster fetches only manifest fighters through content-versioned URLs', async t => {
  roster.splice(0);
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; cache?: RequestCache }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, cache: init?.cache });
    if (url === '/runtime-roster.json') return new Response(JSON.stringify({
      schemaVersion: 1,
      version: hash('a'),
      fighters: [{ id: 'palimpsest', configVersion: hash('b') }],
    }));
    if (url === `/fighters/palimpsest/config.json?v=${hash('b')}`) return new Response(JSON.stringify({
      id: 'palimpsest', displayName: 'Palimpsest', moves: [], rosterGroup: 'oddities',
    }));
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; roster.splice(0); });

  await loadCmsRoster();
  assert.deepEqual(roster.map(fighter => fighter.id), ['palimpsest']);
  assert.deepEqual(requests, [
    { url: '/runtime-roster.json', cache: 'no-cache' },
    { url: `/fighters/palimpsest/config.json?v=${hash('b')}`, cache: undefined },
  ]);
});
