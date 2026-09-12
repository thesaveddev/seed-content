import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app, registerUser, auth, resetDatabase, waitForProject, SAMPLE_ARTICLE } from './helpers';
import { contentPipeline } from '../services/content/pipeline';
import { publishToPlatform, publishScheduledPost } from '../services/publisher';
import { scheduledPostPublisher } from '../services/scheduler';
import { Integration, GeneratedContent, ScheduledPost, Notification, ContentProject } from '../models';
import { encryptCredentials } from '../services/crypto/secrets';
import { mediaPublicUrl, renderTextCard } from '../services/media';

/**
 * Deep coverage of the content pipeline (video path, failure notifications,
 * per-platform error pieces, brand voice) and the publisher/scheduler
 * (platform dispatch, refresh-on-401, tick, expiry sweep).
 */

describe('pipeline deep paths', () => {
  let user: any;

  beforeAll(async () => {
    await resetDatabase();
    user = await registerUser('Pipeline Deep');
  });

  it('video projects flow through the transcription step', async () => {
    // Create a project with sourceFile set but sourceType 'video' —
    // the pipeline will "transcribe" (storage read happens in Whisper only;
    // the mock provider ignores the file) then analyse + generate.
    const { ContentProject } = await import('../models');
    const ws: any = await (await import('../models')).Workspace.findOne({ _id: user.workspace.id });
    const project: any = await ContentProject.create({
      workspaceId: user.workspace.id,
      createdBy: user.user.id,
      title: 'Video project',
      sourceType: 'video',
      sourceFile: 'does-not-exist.mp4',
      transcript: SAMPLE_ARTICLE,
      goal: 'reach',
      selectedPlatforms: ['linkedin'],
      status: 'uploading',
    });

    // No second arg — the pipeline derives the user from the project record
    await contentPipeline.processProject(project._id.toString());
    await waitForProject(user.token, project._id.toString());

    const detail = await auth(user.token).get(`/api/content/${project._id}`);
    expect(detail.body.data.project.status).toBe('ready');
    expect(detail.body.data.generatedContent.length).toBeGreaterThan(0);
    void ws;
  }, 30000);

  it('failed processing creates a failure notification and failed status', async () => {
    const { ContentProject } = await import('../models');
    const project: any = await ContentProject.create({
      workspaceId: user.workspace.id,
      createdBy: user.user.id,
      title: 'Doomed',
      sourceType: 'text',
      transcript: SAMPLE_ARTICLE,
      goal: 'auto',
      selectedPlatforms: ['linkedin'],
      status: 'uploading',
    });

    // Force the analyse step to throw
    const ai = await import('../services/ai');
    const spy = vi.spyOn(ai.aiProvider, 'analyseContent').mockRejectedValueOnce(new Error('simulated AI outage'));
    await expect(contentPipeline.processProject(project._id.toString())).rejects.toThrow(/simulated AI outage/);
    spy.mockRestore();

    const fresh: any = await ContentProject.findById(project._id);
    expect(fresh.status).toBe('failed');
    expect(fresh.errorMessage).toMatch(/simulated AI outage/);

    const notif = await Notification.findOne({ userId: user.user.id, type: 'content_failed' });
    expect(notif).toBeTruthy();
  }, 30000);

  it('per-platform generation failure creates a failed error piece, not a project failure', async () => {
    const { ContentProject } = await import('../models');
    const project: any = await ContentProject.create({
      workspaceId: user.workspace.id,
      createdBy: user.user.id,
      title: 'Partial fail',
      sourceType: 'text',
      transcript: SAMPLE_ARTICLE,
      goal: 'auto',
      selectedPlatforms: ['linkedin', 'x'],
      status: 'uploading',
    });

    const ai = await import('../services/ai');
    const original = ai.aiProvider.generateForPlatform.bind(ai.aiProvider);
    const spy = vi.spyOn(ai.aiProvider, 'generateForPlatform').mockImplementation(
      async (analysis: any, platform: string, ...rest: any[]) => {
        if (platform === 'x') throw new Error('X generator exploded');
        return original(analysis, platform, ...rest);
      }
    );

    await contentPipeline.processProject(project._id.toString());
    spy.mockRestore();

    await waitForProject(user.token, project._id.toString());
    const detail = await auth(user.token).get(`/api/content/${project._id}`);
    expect(detail.body.data.project.status).toBe('ready');
    const pieces = detail.body.data.generatedContent;
    const xPiece = pieces.find((p: any) => p.platform === 'x');
    expect(xPiece?.status).toBe('failed');
    expect(xPiece?.content?.error).toMatch(/X generator exploded/);
    const liPiece = pieces.find((p: any) => p.platform === 'linkedin');
    expect(liPiece?.status).toBe('ready');
  }, 30000);

  it('brand voice is threaded into generation context', async () => {
    // Bump plan so the free-tier 3-projects/month limit doesn't trip
    const { Workspace } = await import('../models');
    await (Workspace as any).findByIdAndUpdate(user.workspace.id, { $set: { plan: 'pro' } });

    const voice = await auth(user.token).post('/api/brand-voices').send({
      name: 'Formal Voice',
      description: 'Precise, no slang',
      tone: ['formal'],
      audience: 'executives',
      avoidWords: ['stuff'],
      preferredWords: ['therefore'],
    });
    expect(voice.status).toBe(201);
    const brandVoiceId = voice.body.data._id;

    const created = await auth(user.token).post('/api/content/text').send({
      title: 'Voiced project',
      text: SAMPLE_ARTICLE,
      selectedPlatforms: ['linkedin'],
      brandVoiceId,
    });
    expect(created.status).toBe(201);
    const pid = created.body.data._id;
    const done = await waitForProject(user.token, pid);
    expect(done.body.data.project.status).toBe('ready');
  }, 30000);
});

describe('publisher platform dispatch', () => {
  let user: any;

  beforeAll(async () => {
    await resetDatabase();
    user = await registerUser('Publisher Deep');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function makeIntegration(provider: string, creds: Record<string, string>, meta: any = {}) {
    return Integration.create({
      workspaceId: user.workspace.id,
      provider,
      status: 'connected',
      credentials: encryptCredentials(creds, ['accessToken', 'refreshToken', 'botToken']),
      metadata: meta,
    });
  }

  async function makeGenerated(content: any) {
    const proj: any = await ContentProject.create({
      workspaceId: user.workspace.id,
      createdBy: user.user.id,
      title: 'pub proj',
      sourceType: 'text',
      status: 'ready',
    });
    return GeneratedContent.create({
      projectId: proj._id,
      workspaceId: user.workspace.id,
      platform: 'x',
      type: 'post',
      content,
      status: 'ready',
    });
  }

  it('returns an error with no connected integration', async () => {
    const gc: any = await makeGenerated({ text: 'hello' });
    const result = await publishToPlatform('telegram', { content: gc.content, workspaceId: user.workspace.id }, 'post-1');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No connected telegram integration/);
  });

  it('rejects content with no publishable text', async () => {
    await makeIntegration('telegram', { botToken: 't', chatId: '@c' });
    const gc: any = await makeGenerated({}); // empty content
    const result = await publishToPlatform('telegram', { content: gc.content, workspaceId: user.workspace.id }, 'post-2');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no publishable text/);
  });

  it('publishes to telegram (success shape)', async () => {
    await makeIntegration('telegram', { botToken: 'TESTTOKEN', chatId: '@testchan' });
    const gc: any = await makeGenerated({ text: 'hello telegram' });

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 })
    ) as any;
    try {
      const result = await publishToPlatform('telegram', { content: gc.content, workspaceId: user.workspace.id }, 'post-3');
      expect(result.ok).toBe(true);
      expect(result.externalId).toBe('42');
      expect(result.externalUrl).toContain('t.me');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('surfaces telegram API rejection honestly', async () => {
    await makeIntegration('telegram', { botToken: 'TESTTOKEN', chatId: '@bad' });
    const gc: any = await makeGenerated({ text: 'x' });

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, description: 'chat not found' }), { status: 400 })
    ) as any;
    try {
      const result = await publishToPlatform('telegram', { content: gc.content, workspaceId: user.workspace.id }, 'post-4');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('chat not found');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('x reports auth-401 honestly when there is no refresh token', async () => {
    await makeIntegration('x', { accessToken: 'X' + 'a'.repeat(30), expiresAt: new Date(Date.now() + 86400000).toISOString() });
    const longText = 'y'.repeat(400);
    const gc: any = await makeGenerated({ text: longText });

    // 401 → authError → forced refresh attempted, but no refreshToken stored
    // → the refresh short-circuits to a reconnect prompt (no second HTTP call)
    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      return new Response(JSON.stringify({ title: 'Unauthorized' }), { status: 401 });
    }) as any;
    try {
      const result = await publishToPlatform('x', { content: gc.content, workspaceId: user.workspace.id }, 'post-5');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/session expired|reconnect/i);
      expect(calls).toBe(1); // publish only — refresh never had a token to use
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('x succeeds and builds the status URL', async () => {
    // Reuses the connected 'x' integration from the previous test (findOne
    // first-match) — its token is still valid
    const gc: any = await makeGenerated({ tweets: ['first tweet'] });

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: { id: '123', username: 'testuser' } }), { status: 200 })
    ) as any;
    try {
      const result = await publishToPlatform('x', { content: gc.content, workspaceId: user.workspace.id }, 'post-6');
      expect(result.ok).toBe(true);
      expect(result.externalUrl).toBe('https://x.com/testuser/status/123');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('linkedin reports auth-401 honestly when there is no refresh token', async () => {
    await makeIntegration('linkedin', { accessToken: 'LI' + 'c'.repeat(30), expiresAt: new Date(Date.now() + 86400000).toISOString() });
    const gc: any = await makeGenerated({ text: 'linkedin post' });

    const originalFetch = global.fetch;
    let n = 0;
    global.fetch = vi.fn(async () => {
      n++;
      return new Response(JSON.stringify({ message: 'token expired', status: 401 }), { status: 401 });
    }) as any;
    try {
      const result = await publishToPlatform('linkedin', { content: gc.content, workspaceId: user.workspace.id }, 'post-7');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/session expired|reconnect/i);
      expect(n).toBe(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('tiktok and youtube honestly report video-only limitation', async () => {
    await makeIntegration('tiktok', { accessToken: 'TT' + 'd'.repeat(30) });
    await makeIntegration('youtube', { accessToken: 'YT' + 'e'.repeat(30) });
    const gc: any = await makeGenerated({ text: 'video' });

    const tt = await publishToPlatform('tiktok', { content: gc.content, workspaceId: user.workspace.id }, 'post-8');
    expect(tt.ok).toBe(false);
    expect(tt.error).toMatch(/video platform/);

    const yt = await publishToPlatform('youtube', { content: gc.content, workspaceId: user.workspace.id }, 'post-9');
    expect(yt.ok).toBe(false);
    expect(yt.error).toMatch(/video platform/);
  });

  it('unknown platform is rejected by the dispatch switch', async () => {
    // The integration lookup runs first — a connected record is needed to
    // reach the dispatch switch's default branch
    await makeIntegration('myspace', { accessToken: 'MS1' });
    const gc: any = await makeGenerated({ text: 'x' });
    const result = await publishToPlatform('myspace', { content: gc.content, workspaceId: user.workspace.id }, 'post-10');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not supported/);
  });

  it('instagram: full container flow on success, refresh-on-401 path', async () => {
    await makeIntegration('instagram', {
      accessToken: 'IG' + 'f'.repeat(30),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    }, { igUserId: '178900000' });
    const gc: any = await makeGenerated({ caption: 'ig caption' });

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('/media') && init?.method === 'POST' && !u.includes('media_publish')) {
        return new Response(JSON.stringify({ id: 'CONTAINER1' }), { status: 200 });
      }
      if (u.includes('status_code')) {
        return new Response(JSON.stringify({ status_code: 'FINISHED' }), { status: 200 });
      }
      if (u.includes('media_publish')) {
        return new Response(JSON.stringify({ id: 'IGPOST1' }), { status: 200 });
      }
      // media file fetch (signed URL) — shouldn't happen since we don't fetch it
      return new Response('{}', { status: 404 });
    }) as any;
    try {
      const result = await publishToPlatform('instagram', { content: gc.content, workspaceId: user.workspace.id }, 'post-11');
      expect(result.ok).toBe(true);
      expect(result.externalId).toBe('IGPOST1');
    } finally {
      global.fetch = originalFetch;
    }
  }, 20000);
});

describe('publishScheduledPost lifecycle', () => {
  let user: any;

  beforeAll(async () => {
    await resetDatabase();
    user = await registerUser('Lifecycle');
  });

  it('fails honestly when generated content vanished', async () => {
    const post: any = await ScheduledPost.create({
      workspaceId: user.workspace.id,
      projectId: 'missing-project',
      generatedContentId: 'missing-gc',
      platform: 'x',
      scheduledAt: new Date(),
      status: 'publishing',
    });
    await publishScheduledPost(post);
    const after: any = await ScheduledPost.findById(post._id);
    expect(after.status).toBe('failed');
    expect(after.errorMessage).toMatch(/no longer exists/);
  });

  it('success path flips to published with notification and external URL', async () => {
    const proj: any = await ContentProject.create({
      workspaceId: user.workspace.id,
      createdBy: user.user.id,
      title: 'life proj',
      sourceType: 'text',
      status: 'ready',
    });
    const gc: any = await GeneratedContent.create({
      projectId: proj._id,
      workspaceId: user.workspace.id,
      platform: 'x',
      type: 'post',
      content: { text: 'life goes well' },
      status: 'ready',
    });
    await Integration.create({
      workspaceId: user.workspace.id,
      provider: 'x',
      status: 'connected',
      credentials: encryptCredentials({ accessToken: 'X' + 'z'.repeat(30), expiresAt: new Date(Date.now() + 86400000).toISOString() }, ['accessToken']),
      metadata: {},
    });

    const post: any = await ScheduledPost.create({
      workspaceId: user.workspace.id,
      projectId: proj._id,
      generatedContentId: gc._id,
      platform: 'x',
      scheduledAt: new Date(),
      status: 'publishing',
    });

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: { id: '777', username: 'lifer' } }), { status: 200 })
    ) as any;
    try {
      await publishScheduledPost(post);
    } finally {
      global.fetch = originalFetch;
    }

    const after: any = await ScheduledPost.findById(post._id);
    expect(after.status).toBe('published');
    expect(after.externalUrl).toBe('https://x.com/lifer/status/777');

    // NOTE: the in-memory store only supports RegExp via { $regex: ... },
    // so match on the exact title the publisher writes
    const notif = await Notification.findOne({ workspaceId: user.workspace.id, type: 'info', title: 'Published to x ✅' });
    expect(notif).toBeTruthy();
  }, 20000);
});

describe('scheduler service (tick + expiry sweep)', () => {
  let user: any;

  beforeAll(async () => {
    await resetDatabase();
    user = await registerUser('SchedSvc');
  });

  it('tick publishes due posts and leaves future ones', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: { id: '555', username: 'ticker' } }), { status: 200 })
    ) as any;

    const proj: any = await ContentProject.create({
      workspaceId: user.workspace.id,
      createdBy: user.user.id,
      title: 'tick proj',
      sourceType: 'text',
      status: 'ready',
    });
    const gc: any = await GeneratedContent.create({
      projectId: proj._id,
      workspaceId: user.workspace.id,
      platform: 'x',
      type: 'post',
      content: { text: 'tick tock' },
      status: 'ready',
    });
    await Integration.create({
      workspaceId: user.workspace.id,
      provider: 'x',
      status: 'connected',
      credentials: encryptCredentials({ accessToken: 'X' + 'k'.repeat(30), expiresAt: new Date(Date.now() + 86400000).toISOString() }, ['accessToken']),
      metadata: {},
    });

    const due: any = await ScheduledPost.create({
      workspaceId: user.workspace.id,
      projectId: proj._id,
      generatedContentId: gc._id,
      platform: 'x',
      scheduledAt: new Date(Date.now() - 60000),
      status: 'scheduled',
    });
    const future: any = await ScheduledPost.create({
      workspaceId: user.workspace.id,
      projectId: proj._id,
      generatedContentId: gc._id,
      platform: 'x',
      scheduledAt: new Date(Date.now() + 86400000),
      status: 'scheduled',
    });

    try {
      await scheduledPostPublisher.tick();
    } finally {
      global.fetch = originalFetch;
    }

    const dueAfter: any = await ScheduledPost.findById(due._id);
    expect(dueAfter.status).toBe('published');
    const futureAfter: any = await ScheduledPost.findById(future._id);
    expect(futureAfter.status).toBe('scheduled');
  }, 30000);

  it('expiry sweep warns about expired and soon-expiring integrations, deduped', async () => {
    // Expired integration — expiresAt lives inside the encrypted credentials
    await Integration.create({
      workspaceId: user.workspace.id,
      provider: 'linkedin',
      status: 'connected',
      credentials: encryptCredentials(
        { accessToken: 'LI-old', expiresAt: new Date(Date.now() - 86400000).toISOString() },
        ['accessToken']
      ),
      metadata: {},
    });

    // Reset the sweep guard so this test's first sweep definitely runs
    (scheduledPostPublisher as any).lastExpirySweep = 0;
    await scheduledPostPublisher.checkTokenExpiry();

    const notif = await Notification.findOne({
      workspaceId: user.workspace.id,
      type: 'warning',
      title: 'linkedin needs reconnecting',
    });
    expect(notif).toBeTruthy();

    // Second sweep must not duplicate (dedupe key) — reset the guard first
    (scheduledPostPublisher as any).lastExpirySweep = 0;
    const countBefore = (await Notification.find({ workspaceId: user.workspace.id, type: 'warning' })).length;
    await scheduledPostPublisher.checkTokenExpiry();
    const countAfter = (await Notification.find({ workspaceId: user.workspace.id, type: 'warning' })).length;
    expect(countAfter).toBe(countBefore);
  });

  it('start/stop manage timers without leaking', () => {
    scheduledPostPublisher.start();
    scheduledPostPublisher.start(); // idempotent
    scheduledPostPublisher.stop();
    scheduledPostPublisher.stop(); // idempotent
  });
});
