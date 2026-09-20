import { build } from 'vite';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
await build({ configFile: 'vite.fight.config.ts' });
// Only published runtime assets, never generation sources, replays or CMS data.
for (const name of ['assets-index.json', 'fighters', 'forms']) {
  await cp(`public/${name}`, `dist-fight/${name}`, {
    recursive: true,
    filter: source => !/(?:^|\/)(?:source|sources)(?:\/|$)/.test(source)
      && !/(?:^|\/)(?:motion|sheets)(?:\/|$)/.test(source)
      && !/\.(?:mp4|webm|psd)$/i.test(source),
  });
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
