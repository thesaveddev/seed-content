import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Covers the environment-dependent branches of the queue and email
 * services by mocking their dynamic imports:
 *  - queue: Redis available (BullMQ wiring) vs unavailable (fallback)
 *  - email: SMTP configured (nodemailer send success/failure)
 */

describe('queue Redis path', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('wires BullMQ when Redis answers ping', async () => {
    const ping = vi.fn(async () => 'PONG');
    const quit = vi.fn(async () => undefined);
    const connect = vi.fn(async () => undefined);
    class FakeRedis {
      on() { return this; }
      connect = connect;
      ping = ping;
      quit = quit;
    }
    const add = vi.fn(async () => ({ id: 'job-9' }));
    class FakeQueue { add = add; }
    class FakeWorker { constructor(public _name: string, public processor: any) {} }

    vi.doMock('ioredis', () => ({ default: FakeRedis }));
    vi.doMock('bullmq', () => ({ Queue: FakeQueue, Worker: FakeWorker }));
    vi.doMock('../config/env', () => ({
      config: { NODE_ENV: 'development', REDIS_URL: 'redis://localhost:6399' },
    }));

    const queueMod = await import('../services/queue');
    const processor = vi.fn(async () => undefined);
    await queueMod.initQueue(processor);

    const jobId = await queueMod.addContentProcessingJob({ projectId: 'p', workspaceId: 'w', userId: 'u' });
    expect(jobId).toBe('job-9');
    expect(add).toHaveBeenCalled();
  });

  it('falls back to in-process when Redis is unreachable', async () => {
    class BrokenRedis {
      on() { return this; }
      connect() { throw new Error('ECONNREFUSED'); }
    }
    vi.doMock('ioredis', () => ({ default: BrokenRedis }));
    vi.doMock('../config/env', () => ({
      config: { NODE_ENV: 'development', REDIS_URL: 'redis://localhost:6399' },
    }));

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const queueMod = await import('../services/queue');
    const processor = vi.fn(async () => undefined);
    await queueMod.initQueue(processor);

    const jobId = await queueMod.addContentProcessingJob({ projectId: 'p2', workspaceId: 'w', userId: 'u' });
    expect(jobId).toBeTruthy();
    // In-process fallback processed the job (its status becomes completed)
    await new Promise((r) => setTimeout(r, 30));
    expect(processor).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('email SMTP path', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('sends through nodemailer when SMTP is configured', async () => {
    const sendMail = vi.fn(async () => ({ messageId: 'm-1' }));
    const createTransport = vi.fn(() => ({ sendMail }));
    vi.doMock('nodemailer', () => ({ default: { createTransport } }));
    vi.doMock('../config/env', () => ({
      config: {
        NODE_ENV: 'development',
        SMTP_HOST: 'smtp.test.local', SMTP_PORT: 587,
        SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'from@test.local',
        FRONTEND_URL: 'http://localhost:5173',
      },
    }));

    const { emailService } = await import('../services/email');
    const ok = await emailService.sendPasswordReset('a@b.com', 'tok', 'http://localhost:5173/reset?token=tok');
    expect(ok).toBe(true);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'a@b.com',
      from: 'from@test.local',
    }));
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.test.local' }));
  });

  it('returns false when the SMTP send throws', async () => {
    const sendMail = vi.fn(async () => { throw new Error('relay refused'); });
    vi.doMock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));
    vi.doMock('../config/env', () => ({
      config: {
        NODE_ENV: 'development',
        SMTP_HOST: 'smtp.test.local', SMTP_PORT: 465,
        SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: '',
        FRONTEND_URL: 'http://localhost:5173',
      },
    }));

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { emailService } = await import('../services/email');
    const ok = await emailService.sendPasswordReset('a@b.com', 'tok', 'http://x/reset');
    expect(ok).toBe(false);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
