import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app, registerUser, auth, resetDatabase } from './helpers';
import {
  buildAuthorizeUrl,
  exchangeCode,
  ensureFreshCredentials,
  isOAuthConfigured,
  OAUTH_PROVIDERS,
} from '../services/oauth';
import { Integration } from '../models';
import { encryptCredentials } from '../services/crypto/secrets';

/**
 * Deep OAuth coverage: authorize-URL building (PKCE + non-PKCE), code
 * exchange success/failure for each grant shape, and the token-refresh
 * lifecycle (fresh token, expired→refresh success, expired→refresh fail).
 */

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('buildAuthorizeUrl', () => {
  it('errors for unknown platforms', () => {
    const r = buildAuthorizeUrl('myspace', 'ws', 'u');
    expect(r.url).toBe('');
    expect(r.error).toMatch(/Unknown platform/);
  });

  it('errors when credentials are not configured', () => {
    // Test env sets no LINKEDIN_CLIENT_ID → unconfigured
    if (!OAUTH_PROVIDERS.linkedin.clientId) {
      const r = buildAuthorizeUrl('linkedin', 'ws', 'u');
      expect(r.url).toBe('');
      expect(r.error).toMatch(/not configured/);
    } else {
      expect(isOAuthConfigured('linkedin')).toBe(true);
    }
  });

  it('builds a PKCE authorize URL for X when configured', () => {
    if (!OAUTH_PROVIDERS.x.clientId) {
      // Not configured in this deployment — inject for the test
      const original = OAUTH_PROVIDERS.x.clientId;
      (OAUTH_PROVIDERS.x as any).clientId = 'test-client';
      (OAUTH_PROVIDERS.x as any).clientSecret = 'test-secret';
      try {
        const r = buildAuthorizeUrl('x', 'ws-1', 'u-1');
        expect(r.url).toContain('https://twitter.com/i/oauth2/authorize');
        expect(r.url).toContain('code_challenge');
        expect(r.url).toContain('S256');
        expect(r.url).toContain('response_type=code');
      } finally {
        (OAUTH_PROVIDERS.x as any).clientId = original;
      }
    } else {
      const r = buildAuthorizeUrl('x', 'ws-1', 'u-1');
      expect(r.url).toContain('code_challenge');
    }
  });

  it('builds a non-PKCE authorize URL for LinkedIn when configured', () => {
    const originalId = OAUTH_PROVIDERS.linkedin.clientId;
    const originalSecret = OAUTH_PROVIDERS.linkedin.clientSecret;
    (OAUTH_PROVIDERS.linkedin as any).clientId = 'li-client';
    (OAUTH_PROVIDERS.linkedin as any).clientSecret = 'li-secret';
    try {
      const r = buildAuthorizeUrl('linkedin', 'ws-2', 'u-2');
      expect(r.url).toContain('https://www.linkedin.com/oauth/v2/authorization');
      expect(r.url).toContain('state=');
      expect(r.url).not.toContain('code_challenge');
    } finally {
      (OAUTH_PROVIDERS.linkedin as any).clientId = originalId;
      (OAUTH_PROVIDERS.linkedin as any).clientSecret = originalSecret;
    }
  });
});

describe('exchangeCode', () => {
  it('rejects unknown/used state tokens', async () => {
    const r = await exchangeCode('linkedin', 'authcode', 'bogus-state');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/state expired or invalid/i);
  });

  it('rejects state minted for a different provider', async () => {
    // Mint a state for x, then try to exchange it against linkedin
    const originalId = OAUTH_PROVIDERS.x.clientId;
    const originalSecret = OAUTH_PROVIDERS.x.clientSecret;
    (OAUTH_PROVIDERS.x as any).clientId = 'x-client';
    (OAUTH_PROVIDERS.x as any).clientSecret = 'x-secret';
    try {
      const { url } = buildAuthorizeUrl('x', 'ws-x', 'u-x');
      const state = new URL(url, 'https://x').searchParams.get('state')!;
      const r = await exchangeCode('linkedin', 'code', state);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/state expired or invalid/i);
    } finally {
      (OAUTH_PROVIDERS.x as any).clientId = originalId;
      (OAUTH_PROVIDERS.x as any).clientSecret = originalSecret;
    }
  });

  it('completes a full exchange for X (Basic auth + PKCE verifier) and stores the integration', async () => {
    await resetDatabase();
    const user = await registerUser('OAuth X');
    const originalId = OAUTH_PROVIDERS.x.clientId;
    const originalSecret = OAUTH_PROVIDERS.x.clientSecret;
    (OAUTH_PROVIDERS.x as any).clientId = 'x-client';
    (OAUTH_PROVIDERS.x as any).clientSecret = 'x-secret';
    try {
      const { url } = buildAuthorizeUrl('x', user.workspace.id, user.user.id);
      const state = new URL(url, 'https://x').searchParams.get('state')!;

      let basicHeader = '';
      global.fetch = vi.fn(async (url: any, init?: any) => {
        // Only the token endpoint carries the Basic auth header; the
        // subsequent verify() call uses Bearer and must not overwrite it
        if (String(url).includes('api.twitter.com/2/oauth2/token')) {
          basicHeader = init?.headers?.Authorization || '';
        }
        return new Response(JSON.stringify({
          access_token: 'AT-' + 'x'.repeat(20),
          refresh_token: 'RT-' + 'x'.repeat(20),
          expires_in: 7200,
        }), { status: 200 });
      }) as any;

      const r = await exchangeCode('x', 'auth-code', state);
      expect(r.ok).toBe(true);
      expect(r.accountName).toBeTruthy();
      expect(basicHeader).toContain('Basic ');

      const stored: any = await Integration.findOne({ workspaceId: user.workspace.id, provider: 'x' });
      expect(stored).toBeTruthy();
      expect(stored.status).toBe('connected');
      expect(stored.metadata.via).toBe('oauth');
      // Credentials are stored encrypted — plaintext must not be present
      expect(JSON.stringify(stored.credentials)).not.toContain('AT-'.slice(0, 3) + 'x'.repeat(20));
    } finally {
      (OAUTH_PROVIDERS.x as any).clientId = originalId;
      (OAUTH_PROVIDERS.x as any).clientSecret = originalSecret;
    }
  }, 20000);

  it('surfaces token-exchange failures honestly', async () => {
    await resetDatabase();
    const user = await registerUser('OAuth Fail');
    const originalId = OAUTH_PROVIDERS.linkedin.clientId;
    const originalSecret = OAUTH_PROVIDERS.linkedin.clientSecret;
    (OAUTH_PROVIDERS.linkedin as any).clientId = 'li-client';
    (OAUTH_PROVIDERS.linkedin as any).clientSecret = 'li-secret';
    try {
      const { url } = buildAuthorizeUrl('linkedin', user.workspace.id, user.user.id);
      const state = new URL(url, 'https://li').searchParams.get('state')!;

      global.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'code already redeemed' }), { status: 400 })
      ) as any;

      const r = await exchangeCode('linkedin', 'bad-code', state);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('code already redeemed');
    } finally {
      (OAUTH_PROVIDERS.linkedin as any).clientId = originalId;
      (OAUTH_PROVIDERS.linkedin as any).clientSecret = originalSecret;
    }
  }, 20000);

  it('surfaces verify() failures (platform rejects the token) honestly', async () => {
    await resetDatabase();
    const user = await registerUser('OAuth VerifyFail');
    const originalId = OAUTH_PROVIDERS.linkedin.clientId;
    const originalSecret = OAUTH_PROVIDERS.linkedin.clientSecret;
    (OAUTH_PROVIDERS.linkedin as any).clientId = 'li-client';
    (OAUTH_PROVIDERS.linkedin as any).clientSecret = 'li-secret';
    try {
      const { url } = buildAuthorizeUrl('linkedin', user.workspace.id, user.user.id);
      const state = new URL(url, 'https://li').searchParams.get('state')!;

      global.fetch = vi.fn(async (url2: any) => {
        if (String(url2).includes('linkedin.com/oauth')) {
          return new Response(JSON.stringify({ access_token: 'AT-li', expires_in: 3600 }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: 'expired' }), { status: 401 });
      }) as any;

      const r = await exchangeCode('linkedin', 'code', state);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/LinkedIn|rejected|401/i);
    } finally {
      (OAUTH_PROVIDERS.linkedin as any).clientId = originalId;
      (OAUTH_PROVIDERS.linkedin as any).clientSecret = originalSecret;
    }
  }, 20000);
});

describe('ensureFreshCredentials', () => {
  let user: any;

  beforeAll(async () => {
    await resetDatabase();
    user = await registerUser('Refresh');
  });

  async function makeIntegration(provider: string, creds: Record<string, string>, meta: any = {}) {
    return Integration.create({
      workspaceId: user.workspace.id,
      provider,
      status: 'connected',
      credentials: encryptCredentials(creds, ['accessToken', 'refreshToken']),
      metadata: meta,
    });
  }

  it('returns creds untouched for unknown providers', async () => {
    const integ: any = await makeIntegration('custom-platform', { accessToken: 'raw' });
    const r = await ensureFreshCredentials(integ);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.refreshed).toBe(false);
  });

  it('skips refresh while the token is still valid', async () => {
    await makeIntegration('x', {
      accessToken: 'valid-token',
      refreshToken: 'rt',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const integ: any = await Integration.findOne({ workspaceId: user.workspace.id, provider: 'x' });
    const r = await ensureFreshCredentials(integ);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.refreshed).toBe(false);
  });

  it('refreshes an expired token and persists the new credentials', async () => {
    await makeIntegration('linkedin', {
      accessToken: 'old-li-token',
      refreshToken: 'li-rt',
      expiresAt: new Date(Date.now() - 3600000).toISOString(),
    });
    const integ: any = await Integration.findOne({ workspaceId: user.workspace.id, provider: 'linkedin' });

    const originalId = OAUTH_PROVIDERS.linkedin.clientId;
    const originalSecret = OAUTH_PROVIDERS.linkedin.clientSecret;
    (OAUTH_PROVIDERS.linkedin as any).clientId = 'li-client';
    (OAUTH_PROVIDERS.linkedin as any).clientSecret = 'li-secret';
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'NEW-li-token', expires_in: 60 * 86400 }), { status: 200 })
    ) as any;
    try {
      const r = await ensureFreshCredentials(integ);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.refreshed).toBe(true);
        expect(r.creds.accessToken).toBe('NEW-li-token');
      }

      const fresh: any = await Integration.findById(integ._id);
      const { decryptCredentials } = await import('../services/crypto/secrets');
      const nowCreds = decryptCredentials(fresh.credentials);
      expect(nowCreds.accessToken).toBe('NEW-li-token');
      expect(fresh.metadata.lastRefreshedAt).toBeTruthy();
    } finally {
      (OAUTH_PROVIDERS.linkedin as any).clientId = originalId;
      (OAUTH_PROVIDERS.linkedin as any).clientSecret = originalSecret;
    }
  }, 20000);

  it('marks the integration errored when refresh fails', async () => {
    await makeIntegration('youtube', {
      accessToken: 'old-yt-token',
      refreshToken: 'yt-rt',
      expiresAt: new Date(Date.now() - 3600000).toISOString(),
    });
    const integ: any = await Integration.findOne({ workspaceId: user.workspace.id, provider: 'youtube' });

    const originalId = OAUTH_PROVIDERS.youtube.clientId;
    const originalSecret = OAUTH_PROVIDERS.youtube.clientSecret;
    (OAUTH_PROVIDERS.youtube as any).clientId = 'yt-client';
    (OAUTH_PROVIDERS.youtube as any).clientSecret = 'yt-secret';
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    ) as any;
    try {
      const r = await ensureFreshCredentials(integ);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/session expired.*reconnect/i);

      const fresh: any = await Integration.findById(integ._id);
      expect(fresh.status).toBe('error');
      expect(fresh.metadata.refreshError).toBeTruthy();
    } finally {
      (OAUTH_PROVIDERS.youtube as any).clientId = originalId;
      (OAUTH_PROVIDERS.youtube as any).clientSecret = originalSecret;
    }
  }, 20000);

  it('force-refresh without a refresh token returns a reconnect prompt', async () => {
    await makeIntegration('instagram', { accessToken: 'ig-token' });
    const integ: any = await Integration.findOne({ workspaceId: user.workspace.id, provider: 'instagram' });
    const r = await ensureFreshCredentials(integ, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/reconnect/i);
  });
});
