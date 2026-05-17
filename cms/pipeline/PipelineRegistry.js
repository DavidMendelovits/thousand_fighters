import { adapterDescriptor, adapterHealth, assertPortAdapter } from './ports.js';

export class PipelineRegistry {
  constructor(initialAdapters = {}) {
    this.adapters = new Map();
    for (const [port, adapter] of Object.entries(initialAdapters)) {
      this.register(port, adapter);
    }
  }

  register(port, adapter) {
    assertPortAdapter(port, adapter);
    this.adapters.set(port, adapter);
    return this;
  }

  has(port) {
    return this.adapters.has(port);
  }

  resolve(port) {
    const adapter = this.adapters.get(port);
    if (!adapter) {
      throw new Error(`No adapter registered for pipeline port: ${port}`);
    }
    return adapter;
  }

  optional(port) {
    return this.adapters.get(port) ?? null;
  }

  describe() {
    return [...this.adapters.entries()].map(([port, adapter]) => adapterDescriptor(port, adapter));
  }

  async health() {
    return Promise.all([...this.adapters.entries()].map(([port, adapter]) => adapterHealth(port, adapter)));
  }
}
