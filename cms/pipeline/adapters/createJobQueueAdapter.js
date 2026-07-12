import { InMemoryJobQueueAdapter } from './inMemoryJobQueueAdapter.js';

export function createJobQueueAdapter(options = {}) {
  const provider = options.provider ?? process.env.JOB_QUEUE_PROVIDER ?? 'memory';
  if (provider === 'memory') return new InMemoryJobQueueAdapter(options);
  throw new Error(`Unsupported job queue provider: ${provider}`);
}
