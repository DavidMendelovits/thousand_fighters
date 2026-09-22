import test from 'node:test';
import assert from 'node:assert/strict';
import { syncRosterCore, type RosterCache } from '../mobile/rosterSyncCore';

const hash = (value: string) => value.repeat(64).slice(0, 64);
const origin = 'https://fighters.example';
const controller = () => new AbortController().signal;

function cache(): RosterCache {
  return {
    schemaVersion: 1,
    origin,
    selectionKey: '*',
    manifestVersion: hash('a'),
    etag: '"roster-a"',
    fighters: [{ id: 'palimpsest', name: 'Palimpsest', configVersion: hash('c') }],
  };
}

test('mobile roster uses If-None-Match and downloads nothing after a 304', async () => {
  const requests: Array<{ url: string; etag: string | null }> = [];
  const cached = cache();
  const result = await syncRosterCore({ origin, selectionKey: '*', activeFighterIds: new Set(), cached, signal: controller(), fetcher: async (input, init) => {
    requests.push({ url: String(input), etag: new Headers(init?.headers).get('if-none-match') });
    return new Response(null, { status: 304 });
  }});
  assert.equal(result.cache, cached);
  assert.equal(result.status, 'not-modified');
  assert.deepEqual(requests, [{ url: `${origin}/runtime-roster.json`, etag: '"roster-a"' }]);
});

test('mobile roster reuses unchanged fighter configs and fetches only changed hashes', async () => {
  const requests: string[] = [];
  const cached = cache();
  const fetcher: typeof fetch = async input => {
    const url = String(input); requests.push(url);
    if (url.endsWith('/runtime-roster.json')) return new Response(JSON.stringify({
      schemaVersion: 1,
      version: hash('b'),
      fighters: [
        { id: 'palimpsest', configVersion: hash('c') },
        { id: 'eventide', configVersion: hash('e') },
      ],
    }), { headers: { etag: '"roster-b"' } });
    if (url.includes('/fighters/eventide/')) return new Response(JSON.stringify({ id: 'eventide', displayName: 'Eventide', moves: [] }));
    throw new Error(`Unexpected request ${url}`);
  };
  const result = await syncRosterCore({ origin, selectionKey: '*', activeFighterIds: new Set(), cached, signal: controller(), fetcher });
  assert.equal(result.status, 'updated');
  assert.deepEqual(result.cache.fighters.map(fighter => fighter.id), ['palimpsest', 'eventide']);
  assert.equal(result.cache.fighters[0], cached.fighters[0]);
  assert.deepEqual(requests, [
    `${origin}/runtime-roster.json`,
    `${origin}/fighters/eventide/config.json?v=${hash('e')}`,
  ]);
});
