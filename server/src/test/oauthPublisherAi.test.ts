import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app, registerUser, auth, resetDatabase } from './helpers';

// Shared sample for mock-provider coverage (kept short)
const SAMPLE_TRANSCRIPT = `I built a SaaS in 3 months. First lesson: ship early. Second: talk to users daily. Third: pricing is hard.`;

/**
 * OAuth internals (authorize URL, state/PKCE, code exchange, refresh),
 * publisher platform dispatch, and the OpenAI-backed AI provider —
 * all external HTTP stubbed via global fetch.
 */

let fetchCalls: { url: string; init: any }[] = [];

function stubFetch(handler: (url: string, init: any) => Promise<Response> | Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
    fetchCalls.push({ url: String(url), init });
    return handler(String(url), init);
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  fetchCalls = [];
  vi.restoreAllMocks();
});

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('OAuth service internals', () => {
  let token: string;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    await resetDatabase();
    const u = await registerUser('OAuth Owner');
    token = u.token;
    workspaceId = u.workspace.id;
    userId = u.user.id;
  });

  it('buildAuthorizeUrl returns an error for unknown and unconfigured providers', async () => {
    const { buildAuthorizeUrl, isOAuthConfigured } = await import('../services/oauth');
    expect(buildAuthorizeUrl('nope', workspaceId, userId).error).toMatch(/Unknown platform/);
    // No LinkedIn credentials in the test env → not configured
    expect(isOAuthConfigured('linkedin')).toBe(false);
    const res = buildAuthorizeUrl('linkedin', workspaceId, userId);
    expect(res.error).toMatch(/not configured/i);
  });

  it('publicBaseUrl strips trailing slashes', async () => {
    const { publicBaseUrl } = await import('../services/oauth');
    expect(publicBaseUrl()).not.toMatch(/\/$/);
  });

  it('full OAuth roundtrip: authorize URL → callback exchanges code, verifies identity, stores encrypted creds', async () => {
    const { buildAuthorizeUrl, exchangeCode } = await import('../services/oauth');

    // Configure LinkedIn by stubbing the provider's client id/secret through env
    process.env.LINKEDIN_CLIENT_ID = 'li-client';
    process.env.LINKEDIN_CLIENT_SECRET = 'li-secret';
    // The registry captured config at import; write through the provider object:
    const oauth = await import('../services/oauth');
    (oauth.OAUTH_PROVIDERS.linkedin as any).clientId = 'li-client';
    (oauth.OAUTH_PROVIDERS.linkedin as any).clientSecret = 'li-secret';

    const { url } = buildAuthorizeUrl('linkedin', workspaceId, userId);
    expect(url).toContain('https://www.linkedin.com/oauth/v2/authorization');
    expect(url).toContain('client_id=li-client');
    expect(url).toContain('response_type=code');
    const state = new URL(url).searchParams.get('state')!;

    stubFetch(async (u) => {
      if (u.includes('/oauth/v2/accessToken')) {
        return jsonResponse({ access_token: 'li-token', expires_in: 60 * 24 * 3600 });
      }
      if (u.includes('/v2/userinfo')) {
        return jsonResponse({ sub: 'urn-member-1', given_name: 'Ada', family_name: 'Lovelace' });
      }
      return jsonResponse({}, 404);
    });

    const outcome = await exchangeCode('linkedin', 'auth-code', state);
    expect(outcome.ok).toBe(true);
    expect(outcome.accountName).toBe('Ada Lovelace');

    const models = await import('../models');
    const integration = await models.Integration.findOne({ workspaceId, provider: 'linkedin' });
    expect(integration?.status).toBe('connected');
    expect(integration?.metadata?.memberUrn).toBe('urn-member-1');
    expect(JSON.stringify(integration?.credentials)).not.toContain('li-token'); // encrypted at rest

    // Replaying the same state fails (single-use)
    const replay = await exchangeCode('linkedin', 'auth-code', state);
    expect(replay.ok).toBe(false);
    expect(replay.error).toMatch(/state expired or invalid/i);

    // Cleanup env
    delete process.env.LINKEDIN_CLIENT_ID;
  });

  it('X uses PKCE and Basic auth; identity verified via /2/users/me', async () => {
    const oauth = await import('../services/oauth');
    (oauth.OAUTH_PROVIDERS.x as any).clientId = 'x-client';
    (oauth.OAUTH_PROVIDERS.x as any).clientSecret = 'x-secret';

    const { url } = oauth.buildAuthorizeUrl('x', workspaceId, userId);
    const params = new URL(url).searchParams;
    expect(url).toContain('twitter.com/i/oauth2/authorize');
    expect(params.get('code_challenge')).toBeTruthy();
    expect(params.get('code_challenge_method')).toBe('S256');

    stubFetch(async (u) => {
      if (u.includes('api.twitter.com/2/oauth2/token')) {
        // Basic auth header required
        const init = fetchCalls.find((c) => c.url === u)?.init;
        expect(init.headers.Authorization).toMatch(/^Basic /);
        return jsonResponse({ access_token: 'x-token', refresh_token: 'x-refresh', expires_in: 7200 });
      }
      if (u.includes('api.twitter.com/2/users/me')) {
        return jsonResponse({ data: { id: '99', username: 'ada' } });
      }
      return jsonResponse({}, 404);
    });

    const { url: url2 } = oauth.buildAuthorizeUrl('x', workspaceId, userId);
    const state2 = new URL(url2).searchParams.get('state')!;
    const outcome = await oauth.exchangeCode('x', 'code', state2);
    expect(outcome.ok).toBe(true);
    expect(outcome.accountName).toBe('@ada');
  });

  it('instagram requires an IG business account; page token becomes the publish credential', async () => {
    const oauth = await import('../services/oauth');
    (oauth.OAUTH_PROVIDERS.instagram as any).clientId = 'ig-client';
    (oauth.OAUTH_PROVIDERS.instagram as any).clientSecret = 'ig-secret';

    stubFetch(async (u) => {
      if (u.includes('graph.facebook.com') && u.includes('oauth/access_token')) {
        return jsonResponse({ access_token: 'ig-user-token', expires_in: 7200 });
      }
      if (u.includes('/me/accounts')) {
        return jsonResponse({ data: [{ id: 'page-1', name: 'Ada Pages', instagram_business_account: { id: 'ig-1', username: 'adabuilds' }, access_token: 'page-token' }] });
      }
      return jsonResponse({}, 404);
    });

    const { url } = oauth.buildAuthorizeUrl('instagram', workspaceId, userId);
    const state = new URL(url).searchParams.get('state')!;
    const outcome = await oauth.exchangeCode('instagram', 'code', state);
    expect(outcome.ok).toBe(true);
    expect(outcome.accountName).toBe('@adabuilds');

    const models = await import('../models');
    const integration = await models.Integration.findOne({ workspaceId, provider: 'instagram' });
    expect(integration?.metadata?.igUserId).toBe('ig-1');
    expect(integration?.metadata?.pageAccessToken).toBeTruthy();
  });

  it('instagram without a business account fails with a helpful message', async () => {
    const oauth = await import('../services/oauth');
    stubFetch(async (u) => {
      if (u.includes('oauth/access_token')) return jsonResponse({ access_token: 'ig-user-token' });
      if (u.includes('/me/accounts')) return jsonResponse({ data: [{ id: 'page-2', name: 'No IG' }] });
      return jsonResponse({}, 404);
    });
    const { url } = oauth.buildAuthorizeUrl('instagram', workspaceId, userId);
    const state = new URL(url).searchParams.get('state')!;
    const outcome = await oauth.exchangeCode('instagram', 'code', state);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/No Instagram Business\/Creator account/i);
  });

  it('token exchange failure surfaces the platform error', async () => {
    const oauth = await import('../services/oauth');
    (oauth.OAUTH_PROVIDERS.tiktok as any).clientId = 'tt-client';
    (oauth.OAUTH_PROVIDERS.tiktok as any).clientSecret = 'tt-secret';
    stubFetch(async () => jsonResponse({ error: 'invalid_grant', error_description: 'code expired' }, 400));
    const { url } = oauth.buildAuthorizeUrl('tiktok', workspaceId, userId);
    const state = new URL(url).searchParams.get('state')!;
    const outcome = await oauth.exchangeCode('tiktok', 'code', state);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/code expired/);
  });

  it('ensureFreshCredentials refreshes near expiry and keeps the old refresh token if omitted', async () => {
    const models = await import('../models');
    const { encryptCredentials } = await import('../services/crypto/secrets');
    const { ensureFreshCredentials } = await import('../services/oauth');

    const oauth = await import('../services/oauth');
    (oauth.OAUTH_PROVIDERS.youtube as any).clientId = 'yt-client';
    (oauth.OAUTH_PROVIDERS.youtube as any).clientSecret = 'yt-secret';

    const integration = await models.Integration.create({
      workspaceId,
      provider: 'youtube',
      status: 'connected',
      credentials: encryptCredentials({
        accessToken: 'old-token',
        refreshToken: 'keep-me',
        expiresAt: new Date(Date.now() + 60_000).toISOString(), // inside the 5-min skew
      }, ['accessToken', 'refreshToken']),
      metadata: {},
    });

    stubFetch(async (u) => {
      if (u.includes('oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'new-token', expires_in: 3600 }); // no refresh_token in response
      }
      return jsonResponse({}, 404);
    });

    const result = await ensureFreshCredentials(integration);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.refreshed).toBe(true);
      expect(result.creds.accessToken).toBe('new-token');
      expect(result.creds.refreshToken).toBe('keep-me'); // preserved
    }

    const refreshed = await models.Integration.findById((integration as any)._id);
    expect(refreshed?.metadata?.lastRefreshedAt).toBeTruthy();
  });

  it('a failed refresh flips the integration to error with the reason', async () => {
    const models = await import('../models');
    const { encryptCredentials } = await import('../services/crypto/secrets');
    const { ensureFreshCredentials } = await import('../services/oauth');

    const integration = await models.Integration.create({
      workspaceId,
      provider: 'linkedin',
      status: 'connected',
      credentials: encryptCredentials({
        accessToken: 'old', refreshToken: 'r', expiresAt: new Date(Date.now() - 1000).toISOString(),
      }, ['accessToken', 'refreshToken']),
      metadata: {},
    });

    stubFetch(async () => jsonResponse({ error: 'invalid_grant' }, 400));
    const result = await ensureFreshCredentials(integration);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/could not be refreshed/);

    const after = await models.Integration.findById((integration as any)._id);
    expect(after?.status).toBe('error');
    expect(after?.metadata?.refreshError).toBeTruthy();
  });

  it('force-refresh without a refresh token fails honestly', async () => {
    const models = await import('../models');
    const { encryptCredentials } = await import('../services/crypto/secrets');
    const { ensureFreshCredentials } = await import('../services/oauth');

    const integration = await models.Integration.create({
      workspaceId,
      provider: 'linkedin',
      status: 'connected',
      credentials: encryptCredentials({ accessToken: 'only' }, ['accessToken']),
      metadata: {},
    });
    const result = await ensureFreshCredentials(integration, true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/reconnect/);
  });
});

describe('Publisher — LinkedIn flow (stubbed)', () => {
  let token: string;
  let workspaceId: string;

  beforeAll(async () => {
    await resetDatabase();
    const u = await registerUser('LinkedIn Pub');
    token = u.token;
    workspaceId = u.workspace.id;
  });

  async function makeSetup(): Promise<{ post: any; gc: any; models: any }> {
    const models = await import('../models');
    const project = await models.ContentProject.create({
      workspaceId, createdBy: (await models.Workspace.findById(workspaceId))!.ownerId,
      title: 'Pub project', sourceType: 'text', status: 'ready',
    });
    const gc = await models.GeneratedContent.create({
      workspaceId, projectId: (project as any)._id, platform: 'linkedin',
      content: { text: 'A LinkedIn post body.' }, status: 'ready',
    });
    const post = await models.ScheduledPost.create({
      workspaceId, projectId: (project as any)._id, generatedContentId: (gc as any)._id,
      platform: 'linkedin', scheduledAt: new Date(Date.now() - 1000), status: 'scheduled',
    });
    // Isolate: findOne returns the first match, so clear integrations from
    // earlier tests in this describe (they share the workspace).
    await models.Integration.deleteMany({ workspaceId });
    return { post, gc, models };
  }

  it('publishes a LinkedIn post end-to-end and marks published with the feed URL', async () => {
    const { publishScheduledPost } = await import('../services/publisher');
    const { encryptCredentials } = await import('../services/crypto/secrets');
    const { post, models } = await makeSetup();

    await models.Integration.create({
      workspaceId, provider: 'linkedin', status: 'connected',
      credentials: encryptCredentials({ accessToken: 'tok', expiresAt: new Date(Date.now() + 3600_000).toISOString() }, ['accessToken']),
      metadata: { memberUrn: 'urn:li:person:MEMBER' },
    });

    stubFetch(async (u) => {
      if (u.includes('ugcPosts')) return jsonResponse({ id: 'urn:li:share:123' });
      return jsonResponse({}, 404);
    });

    await publishScheduledPost(post);

    const done = await models.ScheduledPost.findById((post as any)._id);
    expect(done?.status).toBe('published');
    expect(done?.externalUrl).toBe('https://www.linkedin.com/feed/update/urn:li:share:123');

    const notifs = await models.Notification.find({ workspaceId });
    expect(notifs.some((n: any) => /Published to linkedin/.test(n.title))).toBe(true);
  });

  it('a 401 mid-publish triggers one forced refresh and retry', async () => {
    const { publishScheduledPost } = await import('../services/publisher');
    const { encryptCredentials } = await import('../services/crypto/secrets');
    const oauth = await import('../services/oauth');
    (oauth.OAUTH_PROVIDERS.linkedin as any).clientId = 'li-client';
    (oauth.OAUTH_PROVIDERS.linkedin as any).clientSecret = 'li-secret';

    const { post, models } = await makeSetup();
    await models.Integration.create({
      workspaceId, provider: 'linkedin', status: 'connected',
      credentials: encryptCredentials({
        accessToken: 'stale', refreshToken: 'r', expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      }, ['accessToken', 'refreshToken']),
      metadata: { memberUrn: 'urn:li:person:MEMBER' },
    });

    let ugcCalls = 0;
    stubFetch(async (u) => {
      if (u.includes('ugcPosts')) {
        ugcCalls++;
        return ugcCalls === 1 ? new Response('Unauthorized', { status: 401 }) : jsonResponse({ id: 'urn:li:share:456' });
      }
      if (u.includes('/oauth/v2/accessToken')) return jsonResponse({ access_token: 'fresh', expires_in: 3600 });
      return jsonResponse({}, 404);
    });

    await publishScheduledPost(post);
    expect(ugcCalls).toBe(2); // retried exactly once

    const done = await models.ScheduledPost.findById((post as any)._id);
    expect(done?.status).toBe('published');
  });

  it('an API rejection marks the post failed with the platform message', async () => {
    const { publishScheduledPost } = await import('../services/publisher');
    const { encryptCredentials } = await import('../services/crypto/secrets');
    const { post, models } = await makeSetup();

    await models.Integration.create({
      workspaceId, provider: 'linkedin', status: 'connected',
      credentials: encryptCredentials({ accessToken: 'tok', expiresAt: new Date(Date.now() + 3600_000).toISOString() }, ['accessToken']),
      metadata: { memberUrn: 'urn:li:person:MEMBER' },
    });

    stubFetch(async () => jsonResponse({ message: 'duplicates not allowed' }, 422));
    await publishScheduledPost(post);

    const done = await models.ScheduledPost.findById((post as any)._id);
    expect(done?.status).toBe('failed');
    expect(done?.errorMessage).toMatch(/duplicates not allowed/);
  });

  it('missing memberUrn and unreachable userinfo fails with a reconnect hint', async () => {
    const { publishScheduledPost } = await import('../services/publisher');
    const { encryptCredentials } = await import('../services/crypto/secrets');
    const { post, models } = await makeSetup();

    await models.Integration.create({
      workspaceId, provider: 'linkedin', status: 'connected',
      credentials: encryptCredentials({ accessToken: 'tok', expiresAt: new Date(Date.now() + 3600_000).toISOString() }, ['accessToken']),
      metadata: {}, // no memberUrn
    });

    stubFetch(async () => new Response('nope', { status: 500 }));
    await publishScheduledPost(post);

    const done = await models.ScheduledPost.findById((post as any)._id);
    expect(done?.status).toBe('failed');
    expect(done?.errorMessage).toMatch(/reconnect/i);
  });
});

describe('AI provider (OpenAI-backed, stubbed)', () => {
  it('analyses content via chat completions and parses JSON', async () => {
    stubFetch(async (u) => {
      if (u.includes('api.openai.com')) {
        return jsonResponse({
          choices: [{ message: { content: JSON.stringify({
            title: 'T', summary: 'S', mainTopic: 'M', keyPoints: ['a'], hook: 'h',
            audience: 'devs', painPoints: ['p'], insights: ['i'], story: 's', tone: 'direct',
            cta: 'c', contentType: 'article', keywords: ['k'], entities: [], claims: [],
            suggestedAngles: ['Lessons learned'],
          }) } }],
        });
      }
      return jsonResponse({}, 404);
    });

    const { UserKeyAIProvider } = await import('../services/ai');
    const provider = new UserKeyAIProvider();
    (provider as any).globalClient = {
      chat: { completions: { create: vi.fn(async () => ({
        choices: [{ message: { content: JSON.stringify({
          title: 'T', summary: 'S', mainTopic: 'M', keyPoints: ['a'], hook: 'h',
          audience: 'devs', painPoints: ['p'], insights: ['i'], story: 's', tone: 'direct',
          cta: 'c', contentType: 'article', keywords: ['k'], entities: [], claims: [],
          suggestedAngles: ['Lessons learned'],
        }) } }],
      })) } },
    };

    const analysis = await provider.analyseContent('some transcript');
    expect(analysis.title).toBe('T');
    expect(analysis.keyPoints).toEqual(['a']);
  });

  it('getClient throws a friendly error when no key is configured', async () => {
    const { UserKeyAIProvider } = await import('../services/ai');
    const provider = new UserKeyAIProvider();
    await expect((provider as any).chat('sys', 'user')).rejects.toThrow(/No AI provider configured/);
  });

  it('chatJSON throws when the model returns no JSON object', async () => {
    const { UserKeyAIProvider } = await import('../services/ai');
    const provider = new UserKeyAIProvider();
    (provider as any).globalClient = {
      chat: { completions: { create: vi.fn(async () => ({ choices: [{ message: { content: 'no json here' } }] })) } },
    };
    await expect((provider as any).chatJSON('sys', 'user')).rejects.toThrow(/Failed to parse AI JSON/);
  });

  it('parsePlatformResponse maps array, object, and free-text responses', async () => {
    const { UserKeyAIProvider } = await import('../services/ai');
    const provider = new UserKeyAIProvider();
    const p = (provider as any).parsePlatformResponse.bind(provider);

    const arr = p('linkedin', JSON.stringify([{ type: 'post', text: 'a' }, { text: 'b' }]));
    expect(arr.length).toBe(2);
    expect(arr[0].platform).toBe('linkedin');
    expect(arr[0].type).toBe('post');

    const obj = p('x', JSON.stringify({ text: 'one' }));
    expect(obj[0].content.text).toBe('one');

    const free = p('x', 'plain words not json');
    expect(free[0].content.text).toBe('plain words not json');
  });

  it('qualityCheck falls back to a default score when parsing fails', async () => {
    const { UserKeyAIProvider } = await import('../services/ai');
    const provider = new UserKeyAIProvider();
    (provider as any).globalClient = {
      chat: { completions: { create: vi.fn(async () => ({ choices: [{ message: { content: 'unparseable' } }] })) } },
    };
    const result = await provider.qualityCheck('src', 'gen', 'linkedin');
    expect(result.score).toBe(70);
    expect(result.suggestions[0]).toMatch(/limited analysis/);
  });

  it('rewriteContent passes the brand voice through', async () => {
    const { UserKeyAIProvider } = await import('../services/ai');
    const provider = new UserKeyAIProvider();
    const create = vi.fn(async () => ({ choices: [{ message: { content: 'rewritten!' } }] }));
    (provider as any).globalClient = { chat: { completions: { create } } };
    const out = await provider.rewriteContent('orig', 'punch it up', 'Tone: dry');
    expect(out).toBe('rewritten!');
    const sysMsg = create.mock.calls[0][0].messages[0].content;
    expect(sysMsg).toContain('Brand Voice: Tone: dry');
  });

  it('the mock provider covers every platform without throwing', async () => {
    const { MockAIProvider } = await import('../services/ai/mock');
    const mock = new MockAIProvider();
    const analysis = await mock.analyseContent(SAMPLE_TRANSCRIPT);
    const platforms = ['linkedin', 'x', 'instagram', 'tiktok', 'youtube', 'threads', 'newsletter', 'blog'];
    for (const platform of platforms) {
      const pieces = await mock.generateForPlatform(analysis, platform as any, 'auto');
      expect(Array.isArray(pieces)).toBe(true);
    }
  });

  it('whisper provider maps the verbose_json response', async () => {
    // A real temp file — the SDK call receives fs.createReadStream(path), and
    // a stream on a missing file errors asynchronously (unhandled ENOENT).
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const tmpFile = path.join(os.tmpdir(), `whisper-test-${Date.now()}.mp4`);
    fs.writeFileSync(tmpFile, 'fake audio bytes');

    const fake = {
      audio: { transcriptions: { create: vi.fn(async () => ({
        text: 'hello words', language: 'en', duration: 12,
        segments: [{ start: 0, end: 6, text: 'hello' }],
      })) } },
    };
    vi.doMock('openai', () => ({ default: class { constructor(_opts: any) { return fake; } } }), { overwrite: true });

    const { WhisperTranscriptionProvider } = await import('../services/transcription');
    const provider = new WhisperTranscriptionProvider();
    const result = await provider.transcribe({ filePath: tmpFile });
    expect(result.transcript).toBe('hello words');
    expect(result.segments?.[0].text).toBe('hello');

    vi.doUnmock('openai');
    // The SDK call received a read stream whose async open may still be in
    // flight — delete on a later tick so the stream can settle first.
    setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch { /* already gone */ } }, 500);
  });
});
