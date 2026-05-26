export class InMemoryJobQueueAdapter {
  constructor(options = {}) {
    this.id = options.id ?? 'in-memory-job-queue';
    this.provider = 'local';
    this.capabilities = ['job-queue', 'in-memory'];
    this.concurrency = options.concurrency ?? 4;
    this.jobs = new Map();
    this.running = 0;
    this.pending = [];
  }

  async healthCheck() {
    return {
      status: 'ok',
      message: `In-memory job queue. ${this.jobs.size} jobs tracked, ${this.running} running, ${this.pending.length} pending.`,
      details: { concurrency: this.concurrency, totalJobs: this.jobs.size },
    };
  }

  async enqueue(job) {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record = {
      id: jobId,
      status: 'pending',
      type: job.type ?? 'unknown',
      input: job.input ?? {},
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    this.jobs.set(jobId, record);

    const promise = new Promise((resolve) => {
      this.pending.push({
        id: jobId,
        execute: async () => {
          record.status = 'running';
          try {
            record.result = await job.execute(job.input);
            record.status = 'completed';
          } catch (err) {
            record.error = err.message ?? String(err);
            record.status = 'failed';
          }
          record.completedAt = new Date().toISOString();
          resolve(record);
        },
      });
    });

    this._drain();
    return { jobId, status: 'pending', promise };
  }

  async getJob(jobId) {
    return this.jobs.get(jobId) ?? null;
  }

  _drain() {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const next = this.pending.shift();
      this.running++;
      next.execute().finally(() => {
        this.running--;
        this._drain();
      });
    }
  }
}
