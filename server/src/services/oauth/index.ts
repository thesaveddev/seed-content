import crypto from 'crypto';
import { config } from '../../config/env';
import { encryptCredentials, decryptCredentials } from '../crypto/secrets';
import { Integration } from '../../models';

/**
 * OAuth connect flow for publishing platforms.
 *
 * - "Connect with LinkedIn/X/…" buttons redirect the user to the platform,
 *   the platform calls back to /api/integrations/:provider/oauth/callback,
 *   and we exchange the code for tokens and store them (secrets encrypted).
 * - Tokens for these platforms expire (LinkedIn ~60 days, X ~2h with a
 *   refresh token) so the publisher refreshes on demand and the scheduler
 *   warns users before expiry.
 *
 * State is held in memory with a 10-minute TTL — single-node safe. If the
 * server runs multi-instance, back this store with Redis.
 */

export interface OAuthProviderConfig {
  id: string;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  clientId?: string;
  clientSecret?: string;
  scopes: string[];
  /** Extra params for the authorize URL (e.g. X requires response_type) */
  authorizeParams?: Record<string, string>;
  /** PKCE: send code_verifier (S256) at token exchange */
  usePKCE: boolean;
  /** Map the platform's token response into our stored credential fields */
  mapTokens: (tokens: any) => Record<string, string>;
  /** Fields that must be encrypted at rest */
  secretKeys: string[];
  /** Verify the token with the platform; returns an identity label */
  verify?: (creds: Record<string, string>) => Promise<{ accountName?: string; meta?: Record<string, any> }>;
}

const AUTH_60D = 60 * 24 * 60 * 60; // LinkedIn default token lifetime (seconds)

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn',
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    clientId: config.LINKEDIN_CLIENT_ID,
    clientSecret: config.LINKEDIN_CLIENT_SECRET,
    scopes: ['openid', 'profile', 'w_member_social'],
    usePKCE: false,
    mapTokens: (t) => ({
      accessToken: t.access_token,
      expiresAt: new Date(Date.now() + (t.expires_in ?? AUTH_60D) * 1000).toISOString(),
      ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
      ...(t.refresh_token_expires_in
        ? { refreshExpiresAt: new Date(Date.now() + t.refresh_token_expires_in * 1000).toISOString() }
        : {}),
    }),
    secretKeys: ['accessToken', 'refreshToken'],
    verify: async (creds) => {
      const res = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
      });
      if (!res.ok) throw new Error(`LinkedIn rejected the token (HTTP ${res.status})`);
      const body: any = await res.json();
      const name = [body.given_name, body.family_name].filter(Boolean).join(' ') || 'LinkedIn member';
      return { accountName: name, meta: { memberUrn: body.sub } };
    },
  },

  x: {
    id: 'x',
    label: 'X (Twitter)',
    authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    clientId: config.X_CLIENT_ID,
    clientSecret: config.X_CLIENT_SECRET,
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    usePKCE: true,
    authorizeParams: { response_type: 'code', response_mode: 'query' },
    mapTokens: (t) => ({
      accessToken: t.access_token,
      expiresAt: new Date(Date.now() + (t.expires_in ?? 7200) * 1000).toISOString(),
      ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
    }),
    secretKeys: ['accessToken', 'refreshToken'],
    verify: async (creds) => {
      const res = await fetch('https://api.twitter.com/2/users/me', {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
      });
      if (!res.ok) throw new Error(`X rejected the token (HTTP ${res.status})`);
      const body: any = await res.json();
      const username = body?.data?.username;
      return { accountName: username ? `@${username}` : 'X user', meta: { xUserId: body?.data?.id, xUsername: username } };
    },
  },

  instagram: {
    id: 'instagram',
    label: 'Instagram',
    // Facebook Login for Business — the IG business account is chosen via /me/accounts
    authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    clientId: config.INSTAGRAM_CLIENT_ID,
    clientSecret: config.INSTAGRAM_CLIENT_SECRET,
    scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement', 'business_management'],
    usePKCE: false,
    mapTokens: (t) => ({
      accessToken: t.access_token,
      // short-lived (~2h) at this point; exchanged for long-lived below
      ...(t.expires_in ? { expiresAt: new Date(Date.now() + t.expires_in * 1000).toISOString() } : {}),
    }),
    secretKeys: ['accessToken'],
    // Long-lived exchange + IG account discovery happen in exchangeCode()
    verify: async (creds) => {
      const res = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${encodeURIComponent(creds.accessToken)}`);
      if (!res.ok) throw new Error(`Facebook rejected the token (HTTP ${res.status})`);
      const body: any = await res.json();
      const pages: any[] = body?.data || [];
      const withIg = pages.find((p) => p.instagram_business_account);
      if (!withIg) {
        throw new Error('No Instagram Business/Creator account found linked to your Facebook Pages. Link one in Instagram settings first.');
      }
      return {
        accountName: `@${withIg.instagram_business_account.username || withIg.name || 'instagram'}`,
        meta: {
          igUserId: withIg.instagram_business_account.id,
          pageId: withIg.id,
          pageAccessToken: withIg.access_token, // long-lived page token — the one we publish with
        },
      };
    },
  },

  youtube: {
    id: 'youtube',
    label: 'YouTube',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: config.YOUTUBE_CLIENT_ID,
    clientSecret: config.YOUTUBE_CLIENT_SECRET,
    scopes: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'],
    usePKCE: false,
    authorizeParams: {
      response_type: 'code',
      access_type: 'offline', // forces a refresh token
      prompt: 'consent',
    },
    mapTokens: (t) => ({
      accessToken: t.access_token,
      expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
      ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
    }),
    secretKeys: ['accessToken', 'refreshToken'],
    verify: async (creds) => {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
      });
      if (!res.ok) throw new Error(`Google rejected the token (HTTP ${res.status})`);
      const body: any = await res.json();
      return { accountName: body?.email || body?.sub, meta: { googleSub: body?.sub } };
    },
  },

  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    clientId: config.TIKTOK_CLIENT_ID,
    clientSecret: config.TIKTOK_CLIENT_SECRET,
    scopes: ['user.info.basic', 'video.publish', 'video.upload'],
    usePKCE: false,
    mapTokens: (t) => ({
      accessToken: t.access_token,
      expiresAt: new Date(Date.now() + (t.expires_in ?? 86400) * 1000).toISOString(),
      ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
      ...(t.refresh_expires_in ? { refreshExpiresAt: new Date(Date.now() + t.refresh_expires_in * 1000).toISOString() } : {}),
    }),
    secretKeys: ['accessToken', 'refreshToken'],
    verify: async (creds) => {
      const res = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
      });
      if (!res.ok) throw new Error(`TikTok rejected the token (HTTP ${res.status})`);
      const body: any = await res.json();
      const name = body?.data?.user?.display_name || body?.data?.user?.open_id || 'TikTok creator';
      return { accountName: name, meta: { tiktokOpenId: body?.data?.user?.open_id } };
    },
  },
};

export function isOAuthConfigured(providerId: string): boolean {
  const p = OAUTH_PROVIDERS[providerId];
  return !!(p && p.clientId && p.clientSecret);
}

// ── Callback base URL ────────────────────────────────────────────
// The callback hits the SERVER (this API), so it derives from
// PUBLIC_BASE_URL (prod) with a localhost default for development.

export function publicBaseUrl(): string {
  return (config.PUBLIC_BASE_URL || `http://localhost:${config.PORT}`).replace(/\/$/, '');
}

// ── In-memory state store (CSRF + PKCE + routing context) ────────

interface OAuthState {
  provider: string;
  workspaceId: string;
  userId: string;
  codeVerifier?: string;
  codeChallenge?: string;
  createdAt: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const states = new Map<string, OAuthState>();

function pruneStates() {
  const now = Date.now();
  for (const [k, v] of states) {
    if (now - v.createdAt > STATE_TTL_MS) states.delete(k);
  }
}

// ── Authorize URL ────────────────────────────────────────────────

export function buildAuthorizeUrl(
  providerId: string,
  workspaceId: string,
  userId: string
): { url: string; error?: string } {
  const p = OAUTH_PROVIDERS[providerId];
  if (!p) return { url: '', error: `Unknown platform "${providerId}"` };
  if (!p.clientId || !p.clientSecret) {
    return { url: '', error: `${p.label} OAuth is not configured on this deployment. Ask the admin to set ${providerId.toUpperCase()}_CLIENT_ID / _SECRET.` };
  }

  pruneStates();
  const state = crypto.randomBytes(24).toString('hex');
  const entry: OAuthState = { provider: providerId, workspaceId, userId, createdAt: Date.now() };

  if (p.usePKCE) {
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    entry.codeVerifier = verifier;
    entry.codeChallenge = challenge;
  }

  states.set(state, entry);

  const redirectUri = `${publicBaseUrl()}/api/integrations/${providerId}/oauth/callback`;
  const params = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: redirectUri,
    scope: p.scopes.join(p.id === 'tiktok' ? ',' : ' '),
    state,
    ...(p.authorizeParams || {}),
  });
  if (p.id !== 'youtube') params.set('response_type', p.authorizeParams?.response_type || 'code');
  if (entry.codeChallenge) {
    params.set('code_challenge', entry.codeChallenge);
    params.set('code_challenge_method', 'S256');
  }

  return { url: `${p.authorizeUrl}?${params.toString()}` };
}

// ── Code exchange ────────────────────────────────────────────────

export interface ExchangeOutcome {
  ok: boolean;
  error?: string;
  accountName?: string;
}

export async function exchangeCode(
  providerId: string,
  code: string,
  state: string
): Promise<ExchangeOutcome> {
  pruneStates();
  const entry = states.get(state);
  if (!entry || entry.provider !== providerId) {
    return { ok: false, error: 'OAuth state expired or invalid — start the connection again.' };
  }
  states.delete(state);

  const p = OAUTH_PROVIDERS[providerId];
  if (!p) return { ok: false, error: `Unknown platform "${providerId}"` };

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${publicBaseUrl()}/api/integrations/${providerId}/oauth/callback`,
      client_id: p.clientId || '',
      client_secret: p.clientSecret || '',
      ...(p.usePKCE && entry.codeVerifier ? { code_verifier: entry.codeVerifier } : {}),
    });

    const res = await fetch(p.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // X requires Basic auth instead of body credentials
        ...(p.id === 'x'
          ? { Authorization: `Basic ${Buffer.from(`${p.clientId}:${p.clientSecret}`).toString('base64')}` }
          : {}),
      },
      body,
    });
    const tokens: any = await res.json().catch(() => ({}));
    if (!res.ok || tokens.error) {
      return { ok: false, error: `${p.label} token exchange failed: ${tokens.error_description || tokens.error || `HTTP ${res.status}`}` };
    }

    let creds = p.mapTokens(tokens);

    // Instagram: short-lived user token → long-lived page token via verify()
    // (verify fetches /me/accounts and returns the page access token we publish with)
    const identity = p.verify ? await p.verify(creds) : { accountName: p.label };
    if (identity.meta?.pageAccessToken) {
      creds = {
        ...creds,
        accessToken: identity.meta.pageAccessToken,
        // Facebook page tokens from a long-lived user token are long-lived (~60d)
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      };
    }

    const secretKeys = p.secretKeys;
    const stored = encryptCredentials(creds, secretKeys);

    await Integration.findOneAndUpdate(
      { workspaceId: entry.workspaceId, provider: providerId },
      {
        workspaceId: entry.workspaceId,
        provider: providerId,
        status: 'connected',
        credentials: stored,
        metadata: {
          mode: 'full',
          via: 'oauth',
          connectedAt: new Date().toISOString(),
          ...(identity.accountName ? { accountName: identity.accountName } : {}),
          ...(identity.meta || {}),
        },
      },
      { upsert: true, new: true }
    );

    return { ok: true, accountName: identity.accountName };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'OAuth exchange crashed' };
  }
}

// ── Token refresh ────────────────────────────────────────────────
// Returns the (possibly unchanged) decrypted credentials, refreshing
// against the platform when the access token is expired or near it.

const REFRESH_SKEW_MS = 5 * 60 * 1000; // refresh 5 min before expiry

export async function ensureFreshCredentials(
  integration: any,
  force = false
): Promise<
  { ok: true; creds: Record<string, string>; refreshed: boolean } | { ok: false; error: string }
> {
  const p = OAUTH_PROVIDERS[integration.provider];
  const creds = decryptCredentials(integration.credentials || {});
  if (!p) return { ok: true, creds, refreshed: false };

  const expiresAt = creds.expiresAt ? Date.parse(creds.expiresAt) : NaN;
  const stillValid = Number.isNaN(expiresAt) || expiresAt - REFRESH_SKEW_MS > Date.now();
  if (!force && (stillValid || !creds.refreshToken || !p.clientSecret)) {
    return { ok: true, creds, refreshed: false };
  }
  if (force && !creds.refreshToken) {
    return { ok: false, error: `${p.label} session expired — reconnect the account in Integrations.` };
  }

  // Provider-specific refresh
  try {
    let tokens: any;
    if (p.id === 'linkedin' || p.id === 'x' || p.id === 'youtube' || p.id === 'tiktok') {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
        client_id: p.clientId || '',
        client_secret: p.clientSecret || '',
      });
      const res = await fetch(p.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(p.id === 'x'
            ? { Authorization: `Basic ${Buffer.from(`${p.clientId}:${p.clientSecret}`).toString('base64')}` }
            : {}),
        },
        body,
      });
      tokens = await res.json().catch(() => ({}));
      if (!res.ok || tokens.error) {
        throw new Error(tokens.error_description || tokens.error || `HTTP ${res.status}`);
      }
    } else {
      return { ok: true, creds, refreshed: false }; // provider has no refresh grant we handle
    }

    // Some providers omit the refresh token on refresh — keep the old one then
    const mapped = p.mapTokens(tokens);
    const merged: Record<string, string> = { ...creds, ...mapped };
    if (!mapped.refreshToken && creds.refreshToken) merged.refreshToken = creds.refreshToken;

    const stored = encryptCredentials(merged, p.secretKeys);
    await Integration.findByIdAndUpdate(integration._id, {
      credentials: stored,
      'metadata.lastRefreshedAt': new Date().toISOString(),
    });

    return { ok: true, creds: merged, refreshed: true };
  } catch (err: any) {
    // Refresh failed → the user must reconnect
    await Integration.findByIdAndUpdate(integration._id, {
      status: 'error',
      'metadata.refreshError': err?.message || 'token refresh failed',
      'metadata.refreshErrorAt': new Date().toISOString(),
    });
    return { ok: false, error: `${p.label} session expired and could not be refreshed — reconnect the account in Integrations.` };
  }
}
