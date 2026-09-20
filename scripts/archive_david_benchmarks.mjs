import { readFile } from 'node:fs/promises';
import { createCmsStorage } from '../cms/storage/createCmsStorage.js';
const storage = createCmsStorage();
const events = (await readFile('generated/david/attempts.jsonl', 'utf8')).trim().split('\n').map(JSON.parse);
for (const event of events) {
  const date = event.startedAt.slice(0, 10);
  const observation = event.completedAt.replaceAll(':', '-').replaceAll('.', '-');
  const key = `benchmarks/generation-attempts/${date}/${event.attemptId}-${observation}.json`;
  await storage.putJson(key, { ...event, benchmarkKey: key }, { artifactType: 'external-generation-attempt', provider: event.provider, model: event.model, status: event.status });
}
console.log(`Archived ${events.length} attempts to the local CMS benchmark store (including failures).`);
