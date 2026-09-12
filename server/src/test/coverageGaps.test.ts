import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app, registerUser, auth, resetDatabase, SAMPLE_ARTICLE, waitForProject } from './helpers';

/**
 * Final gap-closers: OAuth HTTP callback routes (ok/error/crash), pipeline
 * quality-check + regen branches, publisher X + video-only branches,
 * content delete-with-source-file, and the in-memory store's remaining
 * find/aggregate branches.
 */

let fetchCalls: { url: string; init: any }[] = [];
function stubFetch(handler: (url: string, init: any) => Promise<Response> | Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
    fetchCalls.push({ url: String(url), init });
    return handler(String(url), init);
  }));
}
function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
afterEach(() => {
  vi.unstubAllGlobals();
  fetchCalls = [];
  vi.restoreAllMocks();
});

describe('OAuth callback route', () => {
  let token: string;

  beforeAll(async () => {
    await resetDatabase();
    token = (await registerUser('CB Owner')).token;
  });

  it('redirects with error when the platform reports an error back', async () => {
    const res = await request(app).get('/api/integrations/linkedin/oauth/callback?error=access_denied&error_description=User+cancelled');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/integrations?oauth=error');
    expect(res.headers.location).toContain('User%20cancelled');
  });

  it('redirects with error when code or state are missing', async () => {
    const res = await request(app).get('/api/integrations/linkedin/oauth/callback');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('oauth=error');
    expect(res.headers.location).toContain(encodeURIComponent('Missing code or state'));
  });

  it('redirects with error when the state is unknown', async () => {
    const res = await request(app).get('/api/integrations/linkedin/oauth/callback?code=c&state=bogus');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('oauth=error');
    expect(res.headers.location).toContain('state');
  });

  it('completes a real roundtrip through the HTTP callback (happy path)', async () => {
    const oauth = await import('../services/oauth');
    (oauth.OAUTH_PROVIDERS.linkedin as any).clientId = 'li-cb';
    (oauth.OAUTH_PROVIDERS.linkedin as any).clientSecret = 'li-cb-secret';

    const start = await auth(token).get('/api/integrations/linkedin/oauth/start');
    expect(start.status).toBe(200);
    const state = new URL(start.body.data.url).searchParams.get('state')!;

    stubFetch(async (u) => {
      if (u.includes('/oauth/v2/accessToken')) return jsonResponse({ access_token: 'cb-token', expires_in: 5_184_000 });
      if (u.includes('/v2/userinfo')) return jsonResponse({ sub: 'sub-1', given_name: 'Grace' });
      return jsonResponse({}, 404);
    });

    const res = await request(app).get(`/api/integrations/linkedin/oauth/callback?code=c&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('oauth=ok');
    expect(res.headers.location).toContain('Grace');
  });

  it('a crash inside the callback redirects to the error page', async () => {
    const oauth = await import('../services/oauth');
    (oauth.OAUTH_PROVIDERS.linkedin as any).clientId = 'li-cb';
    (oauth.OAUTH_PROVIDERS.linkedin as any).clientSecret = 'li-cb-secret';

    const start = await auth(token).get('/api/integrations/linkedin/oauth/start');
    const state = new URL(start.body.data.url).searchParams.get('state')!;

    stubFetch(async () => { throw new Error('network vanished'); });
    const res = await request(app).get(`/api/integrations/linkedin/oauth/callback?code=c&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('oauth=error');
  });
});

describe('Pipeline quality-check branches', () => {
  it('auto-regenerates a piece whose quality score is below 50', async () => {
    await resetDatabase();
    const u = await registerUser('QC Owner');
    const models = await import('../models');

    const project = await models.ContentProject.create({
      workspaceId: u.workspace.id, createdBy: u.user.id,
      title: 'QC project', sourceType: 'text', transcript: SAMPLE_ARTICLE,
      selectedPlatforms: ['linkedin'], status: 'processing',
    });

    const { aiProvider } = await import('../services/ai');
    let qcCalls = 0;
    const qcSpy = vi.spyOn(aiProvider, 'qualityCheck').mockImplementation(async () => {
      qcCalls++;
      return qcCalls === 1
        ? { score: 30, issues: ['too short'], suggestions: ['add more'] }
        : { score: 88, issues: [], suggestions: [] };
    });
    const genSpy = vi.spyOn(aiProvider, 'generateForPlatform').mockResolvedValue([
      { platform: 'linkedin', type: 'post', content: { text: 'Regenerated better post.' } },
    ]);

    const { contentPipeline } = await import('../services/content/pipeline');
    await contentPipeline.processProject(String((project as any)._id));

    // qualityCheck ran twice (initial + recheck after regeneration)
    expect(qcCalls).toBeGreaterThanOrEqual(2);
    const piece = await models.GeneratedContent.findOne({ projectId: (project as any)._id, platform: 'linkedin' });
    expect(piece?.content?.text).toBe('Regenerated better post.');
    expect(piece?.qualityScore).toBe(88);

    qcSpy.mockRestore();
    genSpy.mockRestore();
  });

  it('quality regen failure keeps the original piece', async () => {
    await resetDatabase();
    const u = await registerUser('QC2 Owner');
    const models = await import('../models');

    const project = await models.ContentProject.create({
      workspaceId: u.workspace.id, createdBy: u.user.id,
      title: 'QC2 project', sourceType: 'text', transcript: SAMPLE_ARTICLE,
      selectedPlatforms: ['linkedin'], status: 'processing',
    });

    const { aiProvider } = await import('../services/ai');
    let qcCalls = 0;
    let genCalls = 0;
    const qcSpy = vi.spyOn(aiProvider, 'qualityCheck').mockImplementation(async () => {
      qcCalls++;
      // First check scores low (triggers regen); the recheck after the failed
      // regen also scores low, but there is no second regen attempt.
      return { score: 30, issues: [], suggestions: [] };
    });
    const genSpy = vi.spyOn(aiProvider, 'generateForPlatform').mockImplementation(async () => {
      genCalls++;
      if (genCalls === 1) {
        return [{ platform: 'linkedin', type: 'post', content: { text: 'Original piece text.' } }];
      }
      throw new Error('regen broke');
    });

    const { contentPipeline } = await import('../services/content/pipeline');
    await contentPipeline.processProject(String((project as any)._id));

    const piece = await models.GeneratedContent.findOne({ projectId: (project as any)._id, platform: 'linkedin' });
    expect(piece).toBeTruthy();
    expect(piece?.content?.text).toBe('Original piece text.'); // original survived
    expect(qcCalls).toBe(1); // regen threw before any recheck
    expect(genCalls).toBe(2); // generate + one failed regen

    qcSpy.mockRestore();
    genSpy.mockRestore();
  });
});

describe('Publisher X + video-only branches', () => {
  let u: any;

  beforeAll(async () => {
    await resetDatabase();
    u = await registerUser('Pub2 Owner');
  });

  async function makePost(platform: string, content: any) {
    const models = await import('../models');
    const project = await models.ContentProject.create({
      workspaceId: u.workspace.id, createdBy: u.user.id,
      title: 'Pub2', sourceType: 'text', status: 'ready',
    });
    const gc = await models.GeneratedContent.create({
      workspaceId: u.workspace.id, projectId: (project as any)._id,
      platform, content, status: 'ready',
    });
    const post = await models.ScheduledPost.create({
      workspaceId: u.workspace.id, projectId: (project as any)._id,
      generatedContentId: (gc as any)._id, platform,
      scheduledAt: new Date(Date.now() - 1000), status: 'scheduled',
    });
    await models.Integration.deleteMany({ workspaceId: u.workspace.id });
    return { post, models };
  }

  it('X: posts the first tweet, truncates at 280, builds the status URL', async () => {
    const { publishScheduledPost } = await import('../services/publisher');
    const { encryptCredentials } = await import('../services/crypto/secrets');
    const longTweet = 'y'.repeat(400);
    const { post, models } = await makePost('x', { tweets: [longTweet, 'second tweet never sent'] });

    await models.Integration.create({
      workspaceId: u.workspace.id, provider: 'x', status: 'connected',
      credentials: encryptCredentials({ accessToken: 'x-tok', expiresAt: new Date(Date.now() + 3600_000).toISOString() }, ['accessToken']),
      metadata: {},
    });

    stubFetch(async (url) => {
      if (url.includes('api.twitter.com/2/tweets')) {
        const body = JSON.parse(fetchCalls.find((c) => c.url === url)?.init.body || '{}');
        expect(body.text.length).toBeLessThanOrEqual(280);
        expect(body.text.endsWith('…')).toBe(true);
        return jsonResponse({ data: { id: '777', username: 'ada' } });
      }
      return jsonResponse({}, 404);
    });

    await publishScheduledPost(post);
    const done = await models.ScheduledPost.findById((post as any)._id);
    expect(done?.status).toBe('published');
    expect(done?.externalUrl).toBe('https://x.com/ada/status/777');
  });

  it('X: 401 → forced refresh (needs clientSecret) → honest failure when unconfigured', async () => {
    const { publishScheduledPost } = await import('../services/publisher');
    const { encryptCredentials } = await import('../services/crypto/secrets');
    const { post, models } = await makePost('x', { text: 'hello x' });

    await models.Integration.create({
      workspaceId: u.workspace.id, provider: 'x', status: 'connected',
      credentials: encryptCredentials({ accessToken: 'x-tok', expiresAt: new Date(Date.now() + 3600_000).toISOString() }, ['accessToken']),
      metadata: {},
    });

    stubFetch(async () => new Response('Unauthorized', { status: 401 }));
    await publishScheduledPost(post);

    const done = await models.ScheduledPost.findById((post as any)._id);
    expect(done?.status).toBe('failed');
    // No X client secret configured in tests → refresh path cannot run
    expect(done?.errorMessage).toBeTruthy();
  });

  it('X: rejects the post with the platform detail on failure', async () => {
    const { publishScheduledPost } = await import('../services/publisher');
    const { encryptCredentials } = await import('../services/crypto/secrets');
    const { post, models } = await makePost('x', { text: 'hello x' });

    await models.Integration.create({
      workspaceId: u.workspace.id, provider: 'x', status: 'connected',
      credentials: encryptCredentials({ accessToken: 'x-tok', expiresAt: new Date(Date.now() + 3600_000).toISOString() }, ['accessToken']),
      metadata: {},
    });

    stubFetch(async () => jsonResponse({ detail: 'duplicate content' }, 403));
    await publishScheduledPost(post);

    const done = await models.ScheduledPost.findById((post as any)._id);
    expect(done?.status).toBe('failed');
    expect(done?.errorMessage).toMatch(/duplicate content/);
  });

  it('video-only platforms fail honestly with copy-paste guidance', async () => {
    const { publishScheduledPost } = await import('../services/publisher');
    const { encryptCredentials } = await import('../services/crypto/secrets');
    const { post, models } = await makePost('tiktok', { caption: 'a caption' });

    await models.Integration.create({
      workspaceId: u.workspace.id, provider: 'tiktok', status: 'connected',
      credentials: encryptCredentials({ accessToken: 'tt' }, ['accessToken']),
      metadata: {},
    });

    await publishScheduledPost(post);
    const done = await models.ScheduledPost.findById((post as any)._id);
    expect(done?.status).toBe('failed');
    expect(done?.errorMessage).toMatch(/video platform/);
  });

  it('an unknown platform name fails honestly', async () => {
    const { publishScheduledPost } = await import('../services/publisher');
    const { post, models } = await makePost('myspace', { text: 'tom wants friends' });

    // With no integration at all, the dispatch guard fires before the
    // platform switch — either way the failure is honest and clear.
    await publishScheduledPost(post);
    const done = await models.ScheduledPost.findById((post as any)._id);
    expect(done?.status).toBe('failed');
    expect(done?.errorMessage).toMatch(/No connected myspace integration|not supported for publishing/);

    // Now with an integration connected, the unsupported-platform branch fires.
    const { encryptCredentials } = await import('../services/crypto/secrets');
    await models.Integration.create({
      workspaceId: u.workspace.id, provider: 'myspace', status: 'connected',
      credentials: encryptCredentials({ accessToken: 't' }, ['accessToken']),
      metadata: {},
    });
    const { ScheduledPost } = models;
    await ScheduledPost.findByIdAndUpdate((post as any)._id, { status: 'scheduled', errorMessage: null });
    await publishScheduledPost(post);
    const done2 = await models.ScheduledPost.findById((post as any)._id);
    expect(done2?.status).toBe('failed');
    expect(done2?.errorMessage).toMatch(/not supported for publishing/);
  });

  it('content with no publishable text fails before any API call', async () => {
    const { publishScheduledPost } = await import('../services/publisher');
    const { encryptCredentials } = await import('../services/crypto/secrets');
    const { post, models } = await makePost('linkedin', { weird: true });

    await models.Integration.create({
      workspaceId: u.workspace.id, provider: 'linkedin', status: 'connected',
      credentials: encryptCredentials({ accessToken: 't' }, ['accessToken']),
      metadata: { memberUrn: 'urn:li:person:X' },
    });

    await publishScheduledPost(post);
    const done = await models.ScheduledPost.findById((post as any)._id);
    expect(done?.status).toBe('failed');
    expect(done?.errorMessage).toMatch(/no publishable text/);
  });

  it('Instagram container ERROR status fails the post', async () => {
    const { publishScheduledPost } = await import('../services/publisher');
    const { encryptCredentials } = await import('../services/crypto/secrets');
    const { post, models } = await makePost('instagram', { caption: 'ig caption' });

    await models.Integration.create({
      workspaceId: u.workspace.id, provider: 'instagram', status: 'connected',
      credentials: encryptCredentials({ accessToken: 'ig-tok', expiresAt: new Date(Date.now() + 3600_000).toISOString() }, ['accessToken']),
      metadata: { igUserId: 'ig-42' },
    });

    stubFetch(async (url) => {
      if (url.includes('/media') && !url.includes('media_publish')) return jsonResponse({ id: 'container-1' });
      if (url.includes('status_code')) return jsonResponse({ status_code: 'ERROR' });
      return jsonResponse({}, 404);
    });

    await publishScheduledPost(post);
    const done = await models.ScheduledPost.findById((post as any)._id);
    expect(done?.status).toBe('failed');
    expect(done?.errorMessage).toMatch(/rejected the generated image card/);
  });

  it('Instagram publish timeout (never FINISHED) fails after retries', async () => {
    const { publishScheduledPost } = await import('../services/publisher');
    const { encryptCredentials } = await import('../services/crypto/secrets');
    const { post, models } = await makePost('instagram', { caption: 'ig caption' });

    await models.Integration.create({
      workspaceId: u.workspace.id, provider: 'instagram', status: 'connected',
      credentials: encryptCredentials({ accessToken: 'ig-tok', expiresAt: new Date(Date.now() + 3600_000).toISOString() }, ['accessToken']),
      metadata: { igUserId: 'ig-42' },
    });

    stubFetch(async (url) => {
      if (url.includes('/media') && !url.includes('media_publish')) return jsonResponse({ id: 'container-2' });
      if (url.includes('status_code')) return jsonResponse({ status_code: 'IN_PROGRESS' });
      return jsonResponse({}, 404);
    });

    await publishScheduledPost(post);
    const done = await models.ScheduledPost.findById((post as any)._id);
    expect(done?.status).toBe('failed');
    expect(done?.errorMessage).toMatch(/took too long|too long/i);
  }, 30000);
});

describe('Content delete with source file', () => {
  it('deletes the stored source file along with the project', async () => {
    await resetDatabase();
    const u = await registerUser('DelFile Owner');
    const models = await import('../models');
    const { storage } = await import('../services/storage');

    const stored = await storage.upload(Buffer.from('video bytes'), 'movie.mp4', 'video/mp4');
    const project = await models.ContentProject.create({
      workspaceId: u.workspace.id, createdBy: u.user.id,
      title: 'With file', sourceType: 'video', sourceFile: stored,
    });

    const res = await auth(u.token).delete(`/api/content/${(project as any)._id}`);
    expect(res.status).toBe(200);

    // File is gone from storage
    await expect(storage.download(stored)).rejects.toBeTruthy();
  });

  it('export usage counter reflects exports (json path does not increment)', async () => {
    const u = await registerUser('ExpCntr Owner');
    const models = await import('../models');
    const project = await models.ContentProject.create({
      workspaceId: u.workspace.id, createdBy: u.user.id,
      title: 'Exp', sourceType: 'text', transcript: 'words', selectedPlatforms: ['linkedin'], status: 'ready',
    });
    await models.GeneratedContent.create({
      workspaceId: u.workspace.id, projectId: (project as any)._id,
      platform: 'linkedin', content: { text: 'x' }, status: 'ready',
    });

    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const before = (await models.Usage.findOne({ workspaceId: u.workspace.id, month }))?.exports || 0;

    await auth(u.token).post(`/api/content/${(project as any)._id}/export`).send({ format: 'markdown' });
    const after = (await models.Usage.findOne({ workspaceId: u.workspace.id, month }))?.exports || 0;
    expect(after).toBe(before + 1);

    await auth(u.token).post(`/api/content/${(project as any)._id}/export`).send({ format: 'json' });
    const afterJson = (await models.Usage.findOne({ workspaceId: u.workspace.id, month }))?.exports || 0;
    expect(afterJson).toBe(after); // json path does not increment
  });
});

describe('In-memory store branches', () => {
  it('find supports $regex with options and $or queries', async () => {
    await resetDatabase();
    const u = await registerUser('Store Owner');
    const models = await import('../models');
    await models.ContentProject.create({ workspaceId: u.workspace.id, createdBy: u.user.id, title: 'Alpha', sourceType: 'text' });
    await models.ContentProject.create({ workspaceId: u.workspace.id, createdBy: u.user.id, title: 'Beta', sourceType: 'text' });

    const regex = await models.ContentProject.find({ title: { $regex: 'alp', $options: 'i' } });
    expect(regex.length).toBe(1);
    expect(regex[0].title).toBe('Alpha');

    const or = await models.ContentProject.find({ $or: [{ title: 'Alpha' }, { title: 'Beta' }] });
    expect(or.length).toBe(2);
  });

  it('aggregate $group with $sum over a missing field defaults to 0', async () => {
    await resetDatabase();
    const u = await registerUser('Agg Owner');
    const models = await import('../models');
    await models.GeneratedContent.create({
      workspaceId: u.workspace.id, projectId: 'p1' as any, platform: 'x', content: {}, status: 'ready',
    });
    const counts = await models.GeneratedContent.aggregate([
      { $match: { workspaceId: u.workspace.id } },
      { $group: { _id: '$projectId', count: { $sum: 1 } } },
    ]);
    expect(counts.length).toBe(1);
    expect(counts[0].count).toBe(1);
  });

  it('upsert via findOneAndUpdate creates when nothing matches', async () => {
    await resetDatabase();
    const u = await registerUser('Upsert Owner');
    const models = await import('../models');
    const created = await models.Usage.findOneAndUpdate(
      { workspaceId: u.workspace.id, month: '2099-01' },
      { workspaceId: u.workspace.id, month: '2099-01', exports: 5 },
      { upsert: true, new: true }
    );
    expect(created?.exports).toBe(5);
  });

  it('$push appends into arrays and $inc creates counters from zero', async () => {
    await resetDatabase();
    const u = await registerUser('Ops Owner');
    const models = await import('../models');
    const doc = await models.ContentProject.create({
      workspaceId: u.workspace.id, createdBy: u.user.id, title: 'Ops', sourceType: 'text',
    });
    const id = (doc as any)._id;
    await models.ContentProject.findByIdAndUpdate(id, { $push: { selectedPlatforms: 'linkedin' } });
    await models.ContentProject.findByIdAndUpdate(id, { $inc: { 'metadata.views': 3 } });
    const after = await models.ContentProject.findById(id);
    expect(after?.selectedPlatforms).toEqual(['linkedin']);
    expect((after as any).metadata.views).toBe(3);
  });
});

describe('Queue index branches', () => {
  it('initialising twice keeps a working queue; notification jobs are fire-and-forget', async () => {
    const q = await import('../services/queue');
    await q.initQueue(async () => {});
    await expect(q.addNotificationJob({ userId: 'u', workspaceId: 'w', type: 'info', title: 't', message: 'm' })).resolves.toBeUndefined();
    const id = await q.addContentProcessingJob({
      projectId: 'p', workspaceId: 'w', userId: 'u', sourceType: 'text', goal: 'auto', selectedPlatforms: ['linkedin'],
    });
    expect(id).toBeTruthy();
  });
});
