import { build } from 'vite';
import { cp, mkdir } from 'node:fs/promises';
await build({ configFile: 'vite.fight.config.ts' });
// Only published runtime assets, never generation sources, replays or CMS data.
for (const name of ['assets-index.json', 'fighters', 'forms']) {
  await cp(`public/${name}`, `dist-fight/${name}`, {
    recursive: true,
    filter: source => !/(?:^|\/)(?:source|sources)(?:\/|$)/.test(source)
      && !/\.(?:mp4|webm|psd)$/i.test(source),
  });
}
await mkdir('dist-fight/arenas', { recursive: true });
console.log('Fight client ready in dist-fight. Serve at the origin root over HTTPS.');
