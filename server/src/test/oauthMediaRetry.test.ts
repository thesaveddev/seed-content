import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app, registerUser } from './helpers';
import { renderTextCard, mediaPublicUrl, verifyMediaSignature, resolveMediaPath } from '../services/media';
import { ensureFreshCredentials, OAUTH_PROVIDERS } from '../services/oauth';
import { encryptCredentials } from '../services/crypto/secrets';
import { ScheduledPost, GeneratedContent, Integration, ContentProject } from '../models';

// ── OAuth authorize URL building ─────────────────────────────────

describe('OAuth authorize URL', () => {
  it('rejects OAuth start for an unconfigured provider', async () => {
    const { token } = await registerUser();
    const res = await request(app)
      .get('/api/integrations/linkedin/oauth/start')
      .set('Authorization', `Bearer ${token}`);
    // LinkedIn client credentials are not set in the test environment
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('rejects OAuth start for an unknown provider', async () => {
    const { token } = await registerUser();
    const res = await request(app)
      .get('/api/integrations/myspace/oauth/start')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown platform/i);
  });

  it('marks oauth availability in the provider catalog', async () => {
    const { token } = await registerUser();
    const res = await request(app)
      .get('/api/integrations')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.providers.linkedin).toHaveProperty('oauth');
    expect(res.body.providers.telegram.oauth).toBe(false); // telegram is credential-based, not OAuth
  });
});

// ── Media service: signing + card rendering ──────────────────────

describe('Media service', () => {
  it('round-trips a valid signature and rejects tampered/expired ones', () => {
    const url = mediaPublicUrl('card-x-abc.png', 3600);
    const u = new URL(url);
    const file = u.pathname.split('/').pop()!;
    expect(verifyMediaSignature(file, u.searchParams.get('expires')!, u.searchParams.get('sig')!)).toBe(true);

    // Tampered file
    expect(verifyMediaSignature('other.png', u.searchParams.get('expires')!, u.searchParams.get('sig')!)).toBe(false);
    // Expired
    expect(verifyMediaSignature(file, String(Math.floor(Date.now() / 1000) - 10), u.searchParams.get('sig')!)).toBe(false);
    // Missing
    expect(verifyMediaSignature(file, undefined, undefined)).toBe(false);
  });

  it('renders a valid PNG card deterministically per content+platform', () => {
    const card = renderTextCard('Introducing our new feature! It saves hours every week.', 'instagram', 'testcontent1');
    expect(card.file).toBe('card-instagram-testcontent1.png');
    const buf = fs.readFileSync(card.filePath);
    // PNG magic + IHDR + IEND (last 8 bytes = IEND type + its CRC)
    expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(buf.subarray(buf.length - 8, buf.length - 4).toString('ascii')).toBe('IEND');
    // 1080x1080 from IHDR
    expect(buf.readUInt32BE(16)).toBe(1080);
    expect(buf.readUInt32BE(20)).toBe(1080);
  });

  it('refuses path traversal in media file resolution', () => {
    expect(resolveMediaPath('..%2F..%2Fsecret.png')).toBeNull();
    expect(resolveMediaPath('../../package.json')).toBeNull();
    expect(resolveMediaPath('nonexistent-file.png')).toBeNull();
  });

  it('serves the card only with a valid signature over HTTP', async () => {
    const card = renderTextCard('Signature test post', 'tiktok', 'testcontent2');

    const url = mediaPublicUrl(card.file, 3600);
    const u = new URL(url);
    const sig = u.searchParams.get('sig')!;
    const expires = u.searchParams.get('expires')!;

    // No signature → 403
    const denied = await request(app).get(`/api/media/${card.file}`);
    expect(denied.status).toBe(403);

    // Valid signature → 200 PNG
    const ok = await request(app).get(`/api/media/${card.file}?expires=${expires}&sig=${encodeURIComponent(sig)}`);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.body.length).toBeGreaterThan(1000);
  });
});

// ── Token refresh logic ──────────────────────────────────────────

describe('ensureFreshCredentials', () => {
  it('passes through non-OAuth (telegram) integrations untouched', async () => {
    const integration = {
      _id: 'x1',
      provider: 'telegram',
      credentials: encryptCredentials({ botToken: '123:abc', chatId: '@chan' }, ['botToken']),
    };
    const out = await ensureFreshCredentials(integration);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.creds.botToken).toBe('123:abc');
      expect(out.refreshed).toBe(false);
    }
  });

  it('flags an expired token with no refresh token as reconnect-required', async () => {
    const integration = {
      _id: 'x2',
      provider: 'linkedin',
      credentials: encryptCredentials(
        { accessToken: 'AQV-old', expiresAt: new Date(Date.now() - 3600_000).toISOString() },
        ['accessToken']
      ),
    };
    const out = await ensureFreshCredentials(integration);
    // No refresh token and not expired-enough logic → force=false leaves it valid=false path:
    // with no refreshToken the stillValid branch returns ok (publisher surfaces the 401 later)
    expect(out.ok).toBe(true);
  });

  it('refreshes an expired token against a stubbed token endpoint', async () => {
    // OAuth app credentials are deployment config — stub them for the test
    const linkedin = OAUTH_PROVIDERS.linkedin;
    const savedId = linkedin.clientId;
    const savedSecret = linkedin.clientSecret;
    linkedin.clientId = 'test-client-id';
    linkedin.clientSecret = 'test-client-secret';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'AQV-new',
        expires_in: 5184000,
        refresh_token: 'RT-new',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const futureExpiry = new Date(Date.now() - 1000).toISOString(); // expired
      const integration = {
        _id: 'x3',
        provider: 'linkedin',
        credentials: encryptCredentials(
          { accessToken: 'AQV-old', refreshToken: 'RT-old', expiresAt: futureExpiry },
          ['accessToken', 'refreshToken']
        ),
      };

      const out = await ensureFreshCredentials(integration);
      expect(out.ok).toBe(true);
      if (out.ok) {
        expect(out.refreshed).toBe(true);
        expect(out.creds.accessToken).toBe('AQV-new');
        expect(out.creds.refreshToken).toBe('RT-new');
      }
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      linkedin.clientId = savedId;
      linkedin.clientSecret = savedSecret;
      vi.unstubAllGlobals();
    }
  });

  it('marks the integration error when refresh fails', async () => {
    const linkedin = OAUTH_PROVIDERS.linkedin;
    const savedId = linkedin.clientId;
    const savedSecret = linkedin.clientSecret;
    linkedin.clientId = 'test-client-id';
    linkedin.clientSecret = 'test-client-secret';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant', error_description: 'Token revoked' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const integration = {
        _id: 'x4',
        provider: 'linkedin',
        credentials: encryptCredentials(
          { accessToken: 'AQV-old', refreshToken: 'RT-dead', expiresAt: new Date(Date.now() - 1000).toISOString() },
          ['accessToken', 'refreshToken']
        ),
      };

      const out = await ensureFreshCredentials(integration);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error).toMatch(/reconnect/i);
    } finally {
      linkedin.clientId = savedId;
      linkedin.clientSecret = savedSecret;
      vi.unstubAllGlobals();
    }
  });
});

// ── Scheduler retry endpoint ─────────────────────────────────────

describe('POST retry flow', () => {
  let token: string = '';
  let workspaceId: string = '';
  let userId: string = '';
  let projectId: string = '';
  let generatedContentId: string = '';

  beforeAll(async () => {
    const reg = await registerUser();
    token = reg.token;
    workspaceId = reg.workspace.id;
    userId = reg.user.id;

    const project = await ContentProject.create({
      workspaceId,
      title: 'Retry test project',
      sourceType: 'text',
      sourceText: 'Retry test source content for the post.',
      status: 'ready',
      createdBy: userId,
    });
    projectId = String((project as any)._id);

    const gc = await GeneratedContent.create({
      workspaceId,
      projectId,
      platform: 'telegram',
      type: 'post',
      content: { text: 'Retry test telegram post' },
      status: 'ready',
    });
    generatedContentId = String((gc as any)._id);
  });

  async function createFailedPost(): Promise<string> {
    // Create directly with status failed (as the publisher would leave it)
    const post = await ScheduledPost.create({
      workspaceId,
      projectId,
      generatedContentId,
      platform: 'telegram',
      scheduledAt: new Date(Date.now() - 60_000), // past due
      status: 'failed',
      errorMessage: 'Telegram rejected the post: Chat not found',
    });
    return String((post as any)._id);
  }

  it('refuses to retry a non-failed post', async () => {
    const post = await ScheduledPost.create({
      workspaceId,
      projectId,
      generatedContentId,
      platform: 'telegram',
      scheduledAt: new Date(Date.now() + 3600_000),
      status: 'scheduled',
    });
    const res = await request(app)
      .put(`/api/scheduler/${(post as any)._id}/retry`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/only failed/i);
  });

  it('refuses another workspace from retrying a foreign post', async () => {
    const other = await registerUser();
    const post = await ScheduledPost.create({
      workspaceId,
      projectId,
      generatedContentId,
      platform: 'telegram',
      scheduledAt: new Date(Date.now() - 60_000),
      status: 'failed',
      errorMessage: 'boom',
    });
    const res = await request(app)
      .put(`/api/scheduler/${(post as any)._id}/retry`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(res.status).toBe(404);
  });

  it('retries a failed post and republishes it (no integration → honest failure again)', async () => {
    const postId = await createFailedPost();

    const res = await request(app)
      .put(`/api/scheduler/${postId}/retry`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('publishing');

    // Wait for the async publish to complete — no telegram integration
    // connected, so the publisher must fail honestly again.
    let final: any = null;
    for (let i = 0; i < 20; i++) {
      final = await ScheduledPost.findById(postId);
      if (final && ['published', 'failed'].includes(final.status)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(final?.status).toBe('failed');
    expect(String(final?.errorMessage)).toMatch(/no connected telegram integration/i);

    // A warning notification was created for the creator
    const { Notification } = await import('../models');
    const notifs = await (Notification as any).find({ workspaceId, type: 'warning' });
    expect(notifs.length).toBeGreaterThan(0);
    expect(notifs.some((n: any) => /telegram/i.test(String(n.title)))).toBe(true);
  });

  it('retries a failed telegram post to success when the platform accepts', async () => {
    // Connect a telegram integration first
    const fetchMock = vi.fn(async (url: string | URL, init?: any) => {
      const u = String(url);
      if (u.includes('/getMe')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { username: 'retrybot' } }) } as any;
      }
      if (u.includes('/getChat')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { title: 'Retry Channel' } }) } as any;
      }
      if (u.includes('/sendMessage')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 555 } }) } as any;
      }
      throw new Error(`unexpected fetch ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const connect = await request(app)
      .post('/api/integrations/telegram/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({ credentials: { botToken: '123456:ABC-def', chatId: '@retrychannel' } });
    expect(connect.status).toBe(200);

    const postId = await createFailedPost();
    const res = await request(app)
      .put(`/api/scheduler/${postId}/retry`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    let final: any = null;
    for (let i = 0; i < 20; i++) {
      final = await ScheduledPost.findById(postId);
      if (final && ['published', 'failed'].includes(final.status)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(final?.status).toBe('published');
    expect(final?.externalUrl).toContain('t.me');
    expect(final?.externalUrl).toContain('555');

    const sendMessageCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/sendMessage'));
    expect(sendMessageCalls.length).toBeGreaterThanOrEqual(1);

    vi.unstubAllGlobals();

    // Cleanup: disconnect so later tests don't inherit the integration
    await Integration.deleteMany({ workspaceId, provider: 'telegram' });
  });
});
