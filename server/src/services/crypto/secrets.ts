import crypto from 'crypto';
import { config } from '../../config/env';

// ── Credential encryption at rest (AES-256-GCM) ─────────────────
// Key is derived from ENCRYPTION_KEY when set, otherwise from JWT_SECRET.
// Stored format: v1:<iv-b64>:<authTag-b64>:<ciphertext-b64>
const ENC_KEY = crypto
  .createHash('sha256')
  .update(config.ENCRYPTION_KEY || `${config.JWT_SECRET}|seed-integration-credentials`)
  .digest();

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decryptSecret(stored: string): string {
  try {
    const [version, ivB64, tagB64, dataB64] = String(stored).split(':');
    if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function encryptCredentials(
  creds: Record<string, string>,
  secretKeys: string[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(creds || {})) {
    if (!v) continue;
    out[k] = secretKeys.includes(k) ? encryptSecret(v) : v;
  }
  return out;
}

export function decryptCredentials(creds: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(creds || {})) {
    if (typeof v === 'string' && v.startsWith('v1:')) out[k] = decryptSecret(v);
    else if (v != null) out[k] = String(v);
  }
  return out;
}

export function maskSecret(plain: string): string {
  if (!plain) return '';
  if (plain.length <= 8) return '••••••••';
  return `${plain.slice(0, 4)}••••••${plain.slice(-4)}`;
}
