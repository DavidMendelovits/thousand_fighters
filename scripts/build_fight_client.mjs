import { build } from 'vite';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
await build({ configFile: 'vite.fight.config.ts' });
// Only published runtime assets, never generation sources, replays or CMS data.
const roster = JSON.parse(await readFile('public/runtime-roster.json', 'utf8'));
const runtimeIds = roster.fighters?.map(fighter => fighter.id) ?? [];
if (!runtimeIds.length || runtimeIds.some(id => !/^[a-z0-9_-]+$/i.test(id))) throw new Error('runtime-roster.json has no safe playable fighters');
const copyRuntimeTree = (source, destination) => cp(source, destination, {
  recursive: true,
  filter: source => !/(?:^|\/)(?:source|sources)(?:\/|$)/.test(source)
    && !/(?:^|\/)(?:motion|sheets)(?:\/|$)/.test(source)
    && !/\.(?:mp4|webm|psd)$/i.test(source),
});
await cp('public/runtime-roster.json', 'dist-fight/runtime-roster.json');
await mkdir('dist-fight/fighters', { recursive: true });
await mkdir('dist-fight/forms', { recursive: true });
for (const id of runtimeIds) {
  await copyRuntimeTree(`public/fighters/${id}`, `dist-fight/fighters/${id}`);
  const config = JSON.parse(await readFile(`public/fighters/${id}/config.json`, 'utf8'));
  for (const form of config.forms ?? []) {
    if (!/^[a-z0-9_-]+$/i.test(form.id)) throw new Error(`Unsafe form id in ${id}: ${form.id}`);
    await copyRuntimeTree(`public/forms/${form.id}`, `dist-fight/forms/${form.id}`);
  }
}
await mkdir('dist-fight/arenas', { recursive: true });
await new Promise((resolve, reject) => {
  const child = spawn('python3', ['scripts/optimize_fight_assets.py', 'dist-fight'], { stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Fight asset optimization failed (${code})`)));
});
await writeFile('dist-fight/vercel.json', `${JSON.stringify({
  $schema: 'https://openapi.vercel.sh/vercel.json',
  cleanUrls: false,
  rewrites: [{ source: '/fight', destination: '/fight.html' }],
}, null, 2)}\n`);
console.log('Fight client ready in dist-fight. Serve at the origin root over HTTPS.');
