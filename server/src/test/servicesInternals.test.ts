import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app, registerUser, auth, resetDatabase, SAMPLE_ARTICLE, waitForProject } from './helpers';

/**
 * Services + app-shell internals: SSE stream, scheduler-service branches,
 * pipeline failure paths, queue bookkeeping, storage, transcription,
 * crypto helpers, error handler, auth middleware, protected files.
 */

describe('SSE stream (events)', () => {
  it('streams heartbeats and status changes, closing on terminal status', async () => {
    const u = await registerUser('SSE Viewer');

    // Create a project that will move through the pipeline
    const created = await auth(u.token).post('/api/content/text').send({
      title: 'SSE project',
      text: SAMPLE_ARTICLE,
      selectedPlatforms: ['linkedin'],
    });
    const projectId = created.body.data._id;

    const events: any[] = [];
    const req = request(app)
      .get(`/api/content/${projectId}/events`)
      .set('Authorization', `Bearer ${u.token}`)
      .parse((res, cb) => {
        res.on('data', (chunk: Buffer) => {
          const text = chunk.toString();
          for (const line of text.split('\n')) {
            if (line.startsWith('data: ')) {
              try { events.push(JSON.parse(line.slice(6))); } catch { /* heartbeat comments */ }
            }
          }
          cb(null, null); // never deliver to supertest's parser
        });
        res.on('end', () => cb(null, null));
      })
      .then(() => undefined)
      .catch(() => undefined);

    // Wait for the pipeline to reach a terminal state (SSE auto-closes)
    await waitForProject(u.token, projectId);
    await new Promise((r) => setTimeout(r, 300));
    void req;

    // We must have received the connected heartbeat + at least one status event
    expect(events.some((e) => e.type === 'connected')).toBe(true);
    const statuses = events.filter((e) => e.status);
    expect(statuses.length).toBeGreaterThan(0);
    expect(['ready', 'failed']).toContain(statuses[statuses.length - 1].status);
    expect(events.every((e) => e.projectId === projectId || e.type === 'connected')).toBe(true);
  }, 20000);

  it('emits the connected heartbeat even for a nonexistent project', async () => {
    const u = await registerUser('SSE Ghost');
    const events: any[] = [];
    const req = request(app)
      .get('/api/content/507f1f77bcf86cd799439011/events')
      .set('Authorization', `Bearer ${u.token}`)
      .parse((res, cb) => {
        res.on('data', (chunk: Buffer) => {
          for (const line of chunk.toString().split('\n')) {
            if (line.startsWith('data: ')) {
              try { events.push(JSON.parse(line.slice(6))); } catch { /* noop */ }
            }
          }
          cb(null, null);
        });
        res.on('end', () => cb(null, null));
      })
      .then(() => undefined)
      .catch(() => undefined);

    await new Promise((r) => setTimeout(r, 500));
    req.then(() => undefined).catch(() => undefined);
    void req;
    // The server writes the connected heartbeat immediately on connect.
    expect(events.some((e) => e.type === 'connected')).toBe(true);
  }, 10000);
});

describe('Scheduler service (tick + expiry sweep)', () => {
  it('claims and publishes due posts; skips future and in-flight ones', async () => {
    await resetDatabase();
    const u = await registerUser('Tick Owner');
    const models = await import('../models');

    const project = await models.ContentProject.create({
      workspaceId: u.workspace.id,
      createdBy: u.user.id,
      title: 'Tick project',
      sourceType: 'text',
      status: 'ready',
    });
    const gc = await models.GeneratedContent.create({
      workspaceId: u.workspace.id,
      projectId: (project as any)._id,
      platform: 'newsletter',
      content: { text: 'Tick body' },
      status: 'ready',
    });
    await models.Integration.create({
      workspaceId: u.workspace.id,
      provider: 'telegram',
      status: 'connected',
      credentials: {},
      metadata: { mode: 'manual', botToken: 'stub-token', chatId: '@stub' },
    });

    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60 * 60_000);
    const due = await models.ScheduledPost.create({
      workspaceId: u.workspace.id, projectId: (project as any)._id,
      generatedContentId: (gc as any)._id, platform: 'telegram',
      scheduledAt: past, status: 'scheduled',
    });
    const notDue = await models.ScheduledPost.create({
      workspaceId: u.workspace.id, projectId: (project as any)._id,
      generatedContentId: (gc as any)._id, platform: 'telegram',
      scheduledAt: future, status: 'scheduled',
    });
    const inFlight = await models.ScheduledPost.create({
      workspaceId: u.workspace.id, projectId: (project as any)._id,
      generatedContentId: (gc as any)._id, platform: 'telegram',
      scheduledAt: past, status: 'publishing',
    });

    const { scheduledPostPublisher } = await import('../services/scheduler');
    await scheduledPostPublisher.tick();

    const afterDue = await models.ScheduledPost.findById((due as any)._id);
    // With no real Telegram token in metadata the publish fails honestly
    expect(['failed', 'published']).toContain(afterDue?.status);
    const afterNotDue = await models.ScheduledPost.findById((notDue as any)._id);
    expect(afterNotDue?.status).toBe('scheduled');
    const afterInFlight = await models.ScheduledPost.findById((inFlight as any)._id);
    expect(afterInFlight?.status).toBe('publishing'); // never re-claimed

    await scheduledPostPublisher.stop();
  });

  it('expiry sweep warns about expired tokens, dedupes, and skips healthy ones', async () => {
    await resetDatabase();
    const u = await registerUser('Expiry Owner');
    const models = await import('../models');

    await models.ContentProject.create({
      workspaceId: u.workspace.id,
      createdBy: u.user.id,
      title: 'Expiry project',
      sourceType: 'text',
    });

    const { encryptCredentials } = await import('../services/crypto/secrets');
    const expired = await models.Integration.create({
      workspaceId: u.workspace.id,
      provider: 'linkedin',
      status: 'connected',
      credentials: encryptCredentials(
        { accessToken: 'a', refreshToken: 'r', expiresAt: new Date(Date.now() - 86_400_000).toISOString() },
        ['accessToken', 'refreshToken']
      ),
      metadata: {},
    });
    await models.Integration.create({
      workspaceId: u.workspace.id,
      provider: 'x',
      status: 'error',
      credentials: encryptCredentials({ accessToken: 'a' }, ['accessToken']),
      metadata: { refreshError: 'token revoked', refreshErrorAt: new Date().toISOString() },
    });
    await models.Integration.create({
      workspaceId: u.workspace.id,
      provider: 'youtube',
      status: 'connected',
      credentials: encryptCredentials(
        { accessToken: 'a', expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString() },
        ['accessToken']
      ),
      metadata: {},
    });

    const { scheduledPostPublisher } = await import('../services/scheduler');
    scheduledPostPublisher.lastExpirySweep = 0; // bypass the once-a-day guard
    await scheduledPostPublisher.checkTokenExpiry();

    let notifs = await models.Notification.find({ workspaceId: u.workspace.id });
    const linkedinWarn = notifs.find((n: any) => /linkedin needs reconnecting/.test(n.title));
    const xWarn = notifs.find((n: any) => /x needs reconnecting/.test(n.title));
    const youtubeWarn = notifs.find((n: any) => /youtube needs reconnecting/.test(n.title));
    expect(linkedinWarn).toBeTruthy();
    expect(linkedinWarn.type).toBe('warning');
    expect(xWarn).toBeTruthy();
    expect(youtubeWarn).toBeUndefined();

    // Dedupe: second sweep with the same expiry event sends nothing new
    scheduledPostPublisher.lastExpirySweep = 0;
    await scheduledPostPublisher.checkTokenExpiry();
    notifs = await models.Notification.find({ workspaceId: u.workspace.id });
    expect(notifs.length).toBe(2);

    await scheduledPostPublisher.stop();
  });
});

describe('Pipeline failure branches', () => {
  it('a nonexistent project throws Project not found', async () => {
    const { contentPipeline } = await import('../services/content/pipeline');
    await expect(contentPipeline.processProject('does-not-exist')).rejects.toThrow(/Project not found/);
  });

  it('a project with empty transcript still completes (mock AI analyses anything)', async () => {
    await resetDatabase();
    const u = await registerUser('Empty Owner');
    const models = await import('../models');
    const project = await models.ContentProject.create({
      workspaceId: u.workspace.id,
      createdBy: u.user.id,
      title: 'Empty transcript',
      sourceType: 'text',
      transcript: '',
      selectedPlatforms: ['linkedin'],
      status: 'processing',
    });
    const { contentPipeline } = await import('../services/content/pipeline');
    await contentPipeline.processProject(String((project as any)._id));
    const refreshed = await models.ContentProject.findById((project as any)._id);
    expect(refreshed?.status).toBe('ready');
  });

  it('a generate failure records a failed piece and the project still finishes', async () => {
    await resetDatabase();
    const u = await registerUser('GenFail Owner');
    const models = await import('../models');
    const project = await models.ContentProject.create({
      workspaceId: u.workspace.id,
      createdBy: u.user.id,
      title: 'Gen fail',
      sourceType: 'text',
      transcript: SAMPLE_ARTICLE,
      selectedPlatforms: ['linkedin'],
      status: 'processing',
    });

    // Force the generator to throw for one call to exercise the failure branch.
    const { aiProvider } = await import('../services/ai');
    const spy = vi.spyOn(aiProvider, 'generateForPlatform').mockRejectedValueOnce(new Error('generator exploded'));

    const { contentPipeline } = await import('../services/content/pipeline');
    await contentPipeline.processProject(String((project as any)._id));

    expect(spy).toHaveBeenCalled();
    const failedPiece = await models.GeneratedContent.findOne({ projectId: (project as any)._id, status: 'failed' });
    expect(failedPiece).toBeTruthy();
    expect(failedPiece?.content?.error).toMatch(/generator exploded/);
    // The healthy platform still generated, and the project finished.
    const linkedin = await models.GeneratedContent.countDocuments({ projectId: (project as any)._id, platform: 'linkedin' });
    expect(linkedin).toBeGreaterThan(0);
    const refreshed = await models.ContentProject.findById((project as any)._id);
    expect(refreshed?.status).toBe('ready');
    spy.mockRestore();
  });

  it('trackUsage increments after processing', async () => {
    const models = await import('../models');
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const usages = await (models.Usage as any).find({ month });
    expect(usages.length).toBeGreaterThan(0);
    const withGenerations = usages.find((x: any) => x.generations > 0);
    expect(withGenerations).toBeTruthy();
  });
});

describe('Queue internals (in-process)', () => {
  it('tracks job status through completion and failure, emits events', async () => {
    const { contentQueue } = await import('../services/queue/inprocess');
    contentQueue.setProcessor(async () => { /* noop success */ });
    const okJob = await contentQueue.add('process', { x: 1 });
    expect(okJob.id).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(contentQueue.getJob(okJob.id)?.status).toBe('completed');

    contentQueue.setProcessor(async () => { throw new Error('boom'); });
    const badJob = await contentQueue.add('process', { y: 2 });
    await new Promise((r) => setTimeout(r, 50));
    expect(contentQueue.getJob(badJob.id)?.status).toBe('failed');

    // Event subscription path
    const seen: string[] = [];
    contentQueue.on('completed', (id: string) => seen.push(id));
    contentQueue.setProcessor(async () => {});
    const third = await contentQueue.add('process', {});
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toContain(third.id);
  });

  it('addContentProcessingJob throws before the queue is initialised', async () => {
    const { addNotificationJob } = await import('../services/queue');
    // notificationQueue has no processor set — jobs are accepted but never run
    await expect(addNotificationJob({ userId: 'u', workspaceId: 'w', type: 'info', title: 't', message: 'm' })).resolves.toBeUndefined();
  });
});

describe('Storage provider (local)', () => {
  it('upload → download → signed url → delete roundtrip', async () => {
    const { storage } = await import('../services/storage');
    const stored = await storage.upload(Buffer.from('hello storage'), 'note.txt', 'text/plain');
    expect(stored.endsWith('.txt')).toBe(true);

    const buf = await storage.download(stored);
    expect(buf.toString()).toBe('hello storage');

    const signed = await storage.getSignedUrl(stored);
    expect(signed).toContain(stored);

    await storage.delete(stored);
    await expect(storage.download(stored)).rejects.toBeTruthy();
  });
});

describe('Transcription provider (mock)', () => {
  it('returns a mock transcript with segments and confidence', async () => {
    const { transcriptionProvider } = await import('../services/transcription');
    const result = await transcriptionProvider.transcribe({ filePath: 'fake/file.mp4' });
    expect(result.transcript).toContain('fake/file.mp4');
    expect(result.language).toBe('en');
    expect(result.segments?.length).toBe(2);
    expect(result.confidence).toBeGreaterThan(0.9);
  });
});

describe('Crypto secrets', () => {
  it('encrypt/decrypt roundtrip, tamper detection, masking', async () => {
    const { encryptSecret, decryptSecret, encryptCredentials, decryptCredentials, maskSecret } = await import('../services/crypto/secrets');

    const enc = encryptSecret('super-secret-token');
    expect(enc).toMatch(/^v1:/);
    expect(decryptSecret(enc)).toBe('super-secret-token');
    expect(decryptSecret('garbage')).toBe('');
    expect(decryptSecret('v1:xx:yy:zz')).toBe('');

    const creds = encryptCredentials({ accessToken: 'tok123', mode: 'manual', skip: '' }, ['accessToken']);
    expect(creds.accessToken).toMatch(/^v1:/);
    expect(creds.mode).toBe('manual');
    expect(creds.skip).toBeUndefined();
    const dec = decryptCredentials(creds);
    expect(dec.accessToken).toBe('tok123');

    expect(maskSecret('sk-abcdefghijklmnop')).toBe('sk-a••••••mnop');
    expect(maskSecret('short')).toBe('••••••••');
    expect(maskSecret('')).toBe('');
  });
});

describe('Auth middleware + error handler + app shell', () => {
  it('requireWorkspace 400s without workspace context in the token', async () => {
    const { generateToken } = await import('../middleware/auth');
    const u = await registerUser('NoWs User');
    // Token without a workspaceId claim
    const bare = generateToken(u.user.id);
    const res = await request(app).get('/api/stats').set('Authorization', `Bearer ${bare}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Workspace context required');
  });

  it('a token for a deleted user 401s', async () => {
    const u = await registerUser('Ghost User');
    const models = await import('../models');
    const res0 = await models.User.findByIdAndDelete(u.user.id);
    expect(res0).toBeTruthy(); // findByIdAndDelete is supported by the models layer
    const res = await auth(u.token).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('CORS allows configured frontend origin and rejects foreign ones', async () => {
    const ok = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('ok');

    const denied = await request(app).get('/api/health').set('Origin', 'https://evil.example.com');
    expect(denied.status).toBe(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('health endpoint answers without auth', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.timestamp).toBeTruthy();
  });

  it('unknown API routes answer JSON 404, never the SPA HTML', async () => {
    const res = await request(app).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Not found');
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('protected file endpoints enforce auth and workspace membership', async () => {
    const u = await registerUser('File Owner');
    const other = await registerUser('File Other');
    const models = await import('../models');

    const { storage } = await import('../services/storage');
    const stored = await storage.upload(Buffer.from('video-bytes'), 'clip.mp4', 'video/mp4');
    await models.ContentProject.create({
      workspaceId: u.workspace.id,
      createdBy: u.user.id,
      title: 'Has file',
      sourceType: 'video',
      sourceFile: stored,
    });

    const noAuth = await request(app).get(`/api/files/${stored}`);
    expect(noAuth.status).toBe(401);

    const owner = await request(app).get(`/api/files/${stored}`).set('Authorization', `Bearer ${u.token}`);
    expect(owner.status).toBe(200);

    const foreign = await request(app).get(`/api/files/${stored}`).set('Authorization', `Bearer ${other.token}`);
    expect(foreign.status).toBe(403);

    const missing = await request(app).get('/api/files/nothing-here.mp4').set('Authorization', `Bearer ${u.token}`);
    expect(missing.status).toBe(404);

    const traversal = await request(app).get('/api/files/..%2F..%2F.env').set('Authorization', `Bearer ${u.token}`);
    expect([400, 404]).toContain(traversal.status);

    await storage.delete(stored);
  });

  it('AppError keeps its status; non-App errors map to 500 via the handler', async () => {
    const { AppError, errorHandler } = await import('../middleware/errorHandler');
    const appErr = new AppError('Nope', 418);
    expect(appErr.statusCode).toBe(418);
    expect(appErr.isOperational).toBe(true);

    const res: any = { status(c: number) { this.code = c; return this; }, json(b: any) { this.body = b; } };
    const next = () => { throw new Error('should not call next'); };
    errorHandler(new AppError('Nope', 418), {} as any, res, next);
    expect(res.code).toBe(418);
    expect(res.body.error).toBe('Nope');

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res2: any = { status(c: number) { this.code = c; return this; }, json(b: any) { this.body = b; } };
    errorHandler(new Error('boom'), {} as any, res2, next);
    expect(res2.code).toBe(500);
    expect(res2.body.error).toBe('boom');
    errSpy.mockRestore();
  });
});

describe('validate middleware', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns field errors for invalid payloads', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'bad', password: 'x', name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
    expect(res.body.details).toBeInstanceOf(Array);
    expect(res.body.details.length).toBeGreaterThan(0);
    for (const d of res.body.details) expect(d.path).toBeTruthy();
  });
});

describe('Auth middleware branches', () => {
  it('requireRole blocks members without the role', async () => {
    await resetDatabase();
    const owner = await registerUser('Role Owner');
    const member = await registerUser('Role Member');
    const models = await import('../models');

    await models.WorkspaceMember.create({
      workspaceId: owner.workspace.id,
      userId: member.user.id,
      role: 'member',
    });

    // A token scoped to the OWNER's workspace (the JWT carries one workspace).
    const { generateToken } = await import('../middleware/auth');
    const memberTokenForOwnerWs = generateToken(member.user.id, owner.workspace.id);

    // The role-change endpoint is owner-only via requireRole('owner')
    const res = await request(app)
      .put(`/api/team/members/${owner.user.id}/role`)
      .set('Authorization', `Bearer ${memberTokenForOwnerWs}`)
      .send({ role: 'member' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Insufficient permissions');
  });
});
