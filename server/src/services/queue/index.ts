import { config } from '../../config/env';

export interface ContentProcessingJobData {
  projectId: string;
  workspaceId: string;
  userId: string;
  sourceType: string;
  sourceFile?: string;
  sourceUrl?: string;
  goal: string;
  selectedPlatforms: string[];
  brandVoiceId?: string;
}

export interface NotificationJobData {
  userId: string;
  workspaceId: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, any>;
}

let queueImpl: any = null;
type ContentJobProcessor = (data: ContentProcessingJobData) => Promise<void>;

async function tryRedis(processor?: ContentJobProcessor): Promise<boolean> {
  try {
    // Test Redis connectivity first with a quick ping
    const Redis = (await import('ioredis')).default;
    const testRedis = new Redis(config.REDIS_URL, { connectTimeout: 2000, maxRetriesPerRequest: 0, lazyConnect: true, enableOfflineQueue: false, showFriendlyErrorStack: false });
    testRedis.on('error', () => {});
    await testRedis.connect();
    await testRedis.ping();
    await testRedis.quit();

    // Redis is available — use BullMQ
    const { Queue, Worker } = await import('bullmq');
    const connection = { url: config.REDIS_URL };

    const queue = new Queue('content-processing', { connection });
    queueImpl = {
      add: async (_name: string, data: any, opts?: any) => {
        const job = await queue.add(_name, data, opts);
        return { id: job.id?.toString() || '' };
      },
    };

    if (processor) {
      new Worker('content-processing', async (job) => {
        await processor(job.data as ContentProcessingJobData);
      }, { connection, concurrency: 2 });
    }

    console.log('✅ Queue connected (Redis)');
    return true;
  } catch {
    return false;
  }
}

async function useInProcessQueue(processor?: ContentJobProcessor): Promise<void> {
  const { contentQueue } = await import('./inprocess');

  if (processor) {
    contentQueue.setProcessor(async (data: any) => {
      await processor(data as ContentProcessingJobData);
    });
  }

  queueImpl = contentQueue;
  console.log('✅ Queue ready (in-process, no Redis needed)');
}

export async function initQueue(processor?: ContentJobProcessor): Promise<void> {
  const redisAvailable = await tryRedis(processor);
  if (!redisAvailable) {
    await useInProcessQueue(processor);
  }
}

export async function addContentProcessingJob(data: ContentProcessingJobData): Promise<string> {
  if (!queueImpl) throw new Error('Queue not initialized');

  const result = await queueImpl.add('process', data, {
    attempts: 3,
  });

  return result.id;
}

export async function addNotificationJob(data: NotificationJobData): Promise<void> {
  if (!queueImpl) return;
  await queueImpl.add('notify', data);
}
