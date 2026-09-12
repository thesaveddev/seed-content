// In-process queue for development (no Redis required)
// Falls back to synchronous processing for mock AI

import { EventEmitter } from 'events';

type JobProcessor = (data: any) => Promise<void>;

class InProcessQueue {
  private processor: JobProcessor | null = null;
  private events = new EventEmitter();
  private jobs: Map<string, { data: any; status: string }> = new Map();
  private jobIdCounter = 0;

  setProcessor(processor: JobProcessor) {
    this.processor = processor;
  }

  async add(name: string, data: any, _options?: any): Promise<{ id: string }> {
    const id = String(++this.jobIdCounter);
    this.jobs.set(id, { data, status: 'waiting' });

    // Process immediately in-process
    if (this.processor) {
      this.processor(data)
        .then(() => {
          this.jobs.get(id)!.status = 'completed';
          this.events.emit('completed', id);
        })
        .catch((err) => {
          this.jobs.get(id)!.status = 'failed';
          this.events.emit('failed', id, err);
        });
    }

    return { id };
  }

  on(event: string, callback: (...args: any[]) => void) {
    this.events.on(event, callback);
  }

  getJob(id: string) {
    return this.jobs.get(id);
  }
}

export const contentQueue = new InProcessQueue();
export const notificationQueue = new InProcessQueue();
