import { describe, it, expect, beforeAll } from 'vitest';
import { app, registerUser, auth, resetDatabase } from './helpers';
import { encryptSecret, decryptSecret, maskSecret, encryptCredentials, decryptCredentials } from '../services/crypto/secrets';

describe('Secrets crypto (unit)', () => {
  it('round-trips encryptSecret → decryptSecret', () => {
    const token = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz';
    const encrypted = encryptSecret(token);
    expect(encrypted).toMatch(/^v1:/);
    expect(encrypted).not.toContain(token);
    expect(decryptSecret(encrypted)).toBe(token);
  });

  it('returns empty string for tampered ciphertext (auth tag fails)', () => {
    const encrypted = encryptSecret('super-secret-value');
    const parts = encrypted.split(':');
    parts[3] = Buffer.from('tampered-data').toString('base64');
    expect(decryptSecret(parts.join(':'))).toBe('');
  });

  it('masks secrets without leaking them', () => {
    const masked = maskSecret('123456789:ABCdefGHIjklMNOpqrsTUVwxyz');
    expect(masked.startsWith('1234')).toBe(true);
    expect(masked.endsWith('wxyz')).toBe(true);
    expect(masked).toContain('••••');
    expect(maskSecret('short')).toBe('••••••••');
  });

  it('encryptCredentials encrypts only secret keys', () => {
    const out = encryptCredentials(
      { botToken: 'plain-bot-token-value', chatId: '@mychannel' },
      ['botToken']
    );
    expect(out.botToken).toMatch(/^v1:/);
    expect(out.chatId).toBe('@mychannel');

    const back = decryptCredentials(out);
    expect(back.botToken).toBe('plain-bot-token-value');
    expect(back.chatId).toBe('@mychannel');
  });
});

describe('Integrations API', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('lists providers with field metadata and no stored credentials', async () => {
    const { token } = await registerUser('Integration Lister');
    const res = await auth(token).get('/api/integrations');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]); // nothing connected yet
    expect(res.body.providers.telegram.mode).toBe('full');
    expect(res.body.providers.telegram.fields.some((f: any) => f.key === 'botToken' && f.secret)).toBe(true);
  });

  it('rejects unknown provider with 404', async () => {
    const { token } = await registerUser('Unknown Provider');
    const res = await auth(token).post('/api/integrations/myspace/connect').send({
      credentials: { accessToken: 'x'.repeat(30) },
    });
    expect(res.status).toBe(404);
  });

  it('validate rejects a too-short X token', async () => {
    const { token } = await registerUser('Bad X Token');
    const res = await auth(token).post('/api/integrations/x/validate').send({
      credentials: { accessToken: 'short' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(false);
    expect(res.body.data.detail).toMatch(/not look like a valid X access token/i);
  });

  it('validate accepts a well-formed X token without network calls', async () => {
    const { token } = await registerUser('Good X Token');
    const res = await auth(token).post('/api/integrations/x/validate').send({
      credentials: { accessToken: 'A'.repeat(30) },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
  });

  it('connect stores credentials encrypted and never returns them', async () => {
    const { token, workspace } = await registerUser('Connect X');
    const rawToken = 'B'.repeat(40);

    const connect = await auth(token).post('/api/integrations/x/connect').send({
      credentials: { accessToken: rawToken, handle: '@tester' },
    });
    expect(connect.status).toBe(200);
    expect(connect.body.data.status).toBe('connected');

    // Stored document must contain the encrypted form, not plaintext
    const models = await import('../models');
    const stored = await models.Integration.findOne({ workspaceId: workspace.id, provider: 'x' });
    expect(stored).toBeTruthy();
    const storedStr = JSON.stringify(stored);
    expect(storedStr).not.toContain(rawToken);
    expect(storedStr).toContain('v1:');

    // API responses must never include the raw token
    const list = await auth(token).get('/api/integrations');
    expect(JSON.stringify(list.body)).not.toContain(rawToken);
    const connected = list.body.data.find((i: any) => i.provider === 'x');
    expect(connected.status).toBe('connected');
    expect(connected.metadata.mode).toBe('validate');
  });

  it('connect rejects missing required fields', async () => {
    const { token } = await registerUser('Missing Fields');
    const res = await auth(token).post('/api/integrations/telegram/connect').send({
      credentials: { chatId: '@nochat' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bot token/i);
  });

  it('connect with a genuinely bad Telegram token is rejected', async () => {
    const { token } = await registerUser('Bad Telegram');
    const res = await auth(token).post('/api/integrations/telegram/connect').send({
      credentials: { botToken: '123456:invalid-token-for-real-api', chatId: '@definitelynotachannel' },
    });
    // Verification hits Telegram's real API, which rejects the fake token.
    // Network-dependent: accept both a live rejection and an unreachable-network failure.
    expect([400, 500]).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/rejected|Could not reach Telegram/i);
    }
  });

  it('disconnect removes the integration', async () => {
    const { token } = await registerUser('Disconnect X');
    await auth(token).post('/api/integrations/x/connect').send({
      credentials: { accessToken: 'C'.repeat(30) },
    });

    const del = await auth(token).delete('/api/integrations/x');
    expect(del.status).toBe(200);

    const list = await auth(token).get('/api/integrations');
    expect(list.body.data.find((i: any) => i.provider === 'x')).toBeUndefined();
  });

  it('integrations are workspace-scoped', async () => {
    const owner = await registerUser('Scope Owner');
    const outsider = await registerUser('Scope Outsider');

    await auth(owner.token).post('/api/integrations/x/connect').send({
      credentials: { accessToken: 'D'.repeat(30) },
    });

    const otherList = await auth(outsider.token).get('/api/integrations');
    expect(otherList.body.data).toEqual([]);
  });
});
