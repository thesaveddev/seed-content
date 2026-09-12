import { Router, Response } from 'express';
import { authenticate, requireWorkspace } from '../middleware/auth';
import { Integration } from '../models';
import { AuthRequest } from '../types';
import { encryptCredentials, maskSecret } from '../services/crypto/secrets';

const router = Router();

// ── Provider field definitions ───────────────────────────────────
// What the user must supply, what gets encrypted at rest, and how the
// connection is verified.  Real OAuth flows land here later — these
// fields are what OAuth ultimately provides (tokens / handles).

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  secret: boolean; // encrypted at rest, never returned to the client
  required: boolean;
  help?: string;
}

interface ProviderDef {
  name: string;
  fields: FieldDef[];
  mode: 'full' | 'validate'; // full = auto-publish works; validate = token stored, publishing needs deployment-level API creds
  verify?: (creds: Record<string, string>) => Promise<{ ok: boolean; detail: string; meta?: Record<string, any> }>;
}

async function fetchJson(url: string, init: RequestInit = {}, ms = 12000): Promise<{ status: number; body: any }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

const PROVIDERS: Record<string, ProviderDef> = {
  telegram: {
    name: 'Telegram',
    mode: 'full',
    fields: [
      {
        key: 'botToken',
        label: 'Bot token',
        placeholder: '123456789:ABCdefGHI...',
        secret: true,
        required: true,
        help: 'Create a bot with @BotFather on Telegram and paste the token it gives you.',
      },
      {
        key: 'chatId',
        label: 'Channel or chat ID',
        placeholder: '@mychannel or -1001234567890',
        secret: false,
        required: true,
        help: 'Add your bot as an admin of the channel, then paste the @username or numeric chat ID.',
      },
    ],
    verify: async (creds) => {
      try {
        const me = await fetchJson(`https://api.telegram.org/bot${creds.botToken}/getMe`);
        if (me.status !== 200 || me.body?.ok !== true) {
          const desc = me.body?.description || `HTTP ${me.status}`;
          return { ok: false, detail: `Bot token rejected: ${desc}` };
        }
        const chat = await fetchJson(`https://api.telegram.org/bot${creds.botToken}/getChat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: creds.chatId }),
        });
        if (chat.status !== 200 || chat.body?.ok !== true) {
          const desc = chat.body?.description || `HTTP ${chat.status}`;
          return {
            ok: false,
            detail: `Chat "${creds.chatId}" not reachable: ${desc}. Add the bot as an admin to the channel and use the @username or numeric ID.`,
          };
        }
        const title = chat.body?.result?.title || chat.body?.result?.username || creds.chatId;
        return { ok: true, detail: `Verified as @${me.body.result.username} → ${title}`, meta: { chatTitle: title, botUsername: me.body.result.username } };
      } catch (err: any) {
        return { ok: false, detail: `Could not reach Telegram: ${err?.message || 'network error'}` };
      }
    },
  },

  linkedin: {
    name: 'LinkedIn',
    mode: 'validate',
    fields: [
      {
        key: 'accessToken',
        label: 'Access token',
        placeholder: 'AQV...',
        secret: true,
        required: true,
        help: 'From a LinkedIn Developer app with the "w_member_social" product. Used to verify the connection; automatic posting ships when the app is approved.',
      },
    ],
    verify: async (creds) => {
      try {
        const r = await fetchJson('https://api.linkedin.com/v2/userinfo', {
          headers: { Authorization: `Bearer ${creds.accessToken}` },
        });
        if (r.status !== 200) {
          return { ok: false, detail: `LinkedIn rejected the token (HTTP ${r.status}). Check that it has not expired and includes the w_member_social scope.` };
        }
        const name = [r.body?.given_name, r.body?.family_name].filter(Boolean).join(' ') || 'LinkedIn member';
        return { ok: true, detail: `Verified as ${name}`, meta: { accountName: name, memberUrn: r.body?.sub } };
      } catch (err: any) {
        return { ok: false, detail: `Could not reach LinkedIn: ${err?.message || 'network error'}` };
      }
    },
  },

  youtube: {
    name: 'YouTube',
    mode: 'validate',
    fields: [
      {
        key: 'accessToken',
        label: 'OAuth access token',
        placeholder: 'ya29....',
        secret: true,
        required: true,
        help: 'From a Google Cloud OAuth client with youtube.upload scope.',
      },
    ],
    verify: async (creds) => {
      try {
        const r = await fetchJson('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${creds.accessToken}` },
        });
        if (r.status !== 200) {
          return { ok: false, detail: `Google rejected the token (HTTP ${r.status}).` };
        }
        return { ok: true, detail: `Verified as ${r.body?.email || r.body?.sub}`, meta: { accountName: r.body?.email } };
      } catch (err: any) {
        return { ok: false, detail: `Could not reach Google: ${err?.message || 'network error'}` };
      }
    },
  },

  x: {
    name: 'X (Twitter)',
    mode: 'validate',
    fields: [
      {
        key: 'accessToken',
        label: 'Access token + secret',
        placeholder: 'OAuth 1.0a token',
        secret: true,
        required: true,
        help: 'From an X Developer portal app. Stored for the upcoming publishing integration.',
      },
      { key: 'handle', label: 'Handle (optional)', placeholder: '@yourname', secret: false, required: false },
    ],
    verify: async (creds) => {
      if (!creds.accessToken || creds.accessToken.length < 20) {
        return { ok: false, detail: 'That does not look like a valid X access token.' };
      }
      return { ok: true, detail: 'Token stored — publishing activates when platform API credentials are configured.' };
    },
  },

  instagram: {
    name: 'Instagram',
    mode: 'validate',
    fields: [
      {
        key: 'accessToken',
        label: 'Graph API access token',
        placeholder: 'IGQV...',
        secret: true,
        required: true,
        help: 'From a Meta for Developers app linked to your Business/Creator account.',
      },
      { key: 'username', label: 'Username (optional)', placeholder: '@yourbrand', secret: false, required: false },
    ],
    verify: async (creds) => {
      if (!creds.accessToken || creds.accessToken.length < 20) {
        return { ok: false, detail: 'That does not look like a valid Instagram access token.' };
      }
      return { ok: true, detail: 'Token stored — publishing activates when platform API credentials are configured.' };
    },
  },

  tiktok: {
    name: 'TikTok',
    mode: 'validate',
    fields: [
      {
        key: 'accessToken',
        label: 'Access token',
        placeholder: 'act....',
        secret: true,
        required: true,
        help: 'From a TikTok for Developers app with video.publish scope.',
      },
      { key: 'username', label: 'Username (optional)', placeholder: '@yourbrand', secret: false, required: false },
    ],
    verify: async (creds) => {
      if (!creds.accessToken || creds.accessToken.length < 10) {
        return { ok: false, detail: 'That does not look like a valid TikTok access token.' };
      }
      return { ok: true, detail: 'Token stored — publishing activates when platform API credentials are configured.' };
    },
  },
};

function publicIntegration(doc: any) {
  if (!doc) return doc;
  const def = PROVIDERS[doc.provider];
  const fields = def?.fields || [];
  const creds = doc.credentials || {};
  // Never ship secrets back — only non-secret values and masked secrets.
  const safeCreds: Record<string, string> = {};
  for (const f of fields) {
    if (!creds[f.key]) continue;
    safeCreds[f.key] = f.secret ? maskSecret(String(creds[f.key])) : String(creds[f.key]);
  }
  return {
    _id: doc._id,
    workspaceId: doc.workspaceId,
    provider: doc.provider,
    status: doc.status,
    metadata: doc.metadata || {},
    credentialSummary: safeCreds,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function runVerification(provider: string, plainCreds: Record<string, string>) {
  const def = PROVIDERS[provider];
  if (!def) return { ok: false, detail: `Unknown platform "${provider}"` };
  for (const f of def.fields) {
    if (f.required && !plainCreds[f.key]?.trim()) {
      return { ok: false, detail: `${f.label} is required` };
    }
  }
  if (def.verify) return def.verify(plainCreds);
  return { ok: true, detail: 'Credentials stored' };
}

// ── GET /api/integrations — list (credentials stripped) ──────────
router.get('/', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const integrations = await Integration.find({ workspaceId: req.workspaceId });
    res.json({
      success: true,
      data: integrations.map(publicIntegration),
      providers: Object.fromEntries(
        Object.entries(PROVIDERS).map(([id, def]) => [
          id,
          {
            mode: def.mode,
            fields: def.fields.map((f) => ({
              key: f.key,
              label: f.label,
              placeholder: f.placeholder,
              required: f.required,
              secret: f.secret,
              help: f.help || '',
            })),
          },
        ])
      ),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/integrations/:provider/validate — dry-run check ────
router.post('/:provider/validate', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const provider = req.params.provider;
    if (!PROVIDERS[provider]) {
      res.status(404).json({ success: false, error: `Unknown platform "${provider}"` });
      return;
    }
    const plain: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.body?.credentials || {})) {
      if (typeof v === 'string' && v.trim() && !String(v).includes('••••')) plain[k] = v.trim();
    }
    const result = await runVerification(provider, plain);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/integrations/:provider/connect — verify then save ──
router.post('/:provider/connect', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const provider = req.params.provider;
    const def = PROVIDERS[provider];
    if (!def) {
      res.status(404).json({ success: false, error: `Unknown platform "${provider}"` });
      return;
    }

    const plain: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.body?.credentials || {})) {
      if (typeof v === 'string' && v.trim() && !String(v).includes('••••')) plain[k] = v.trim();
    }

    const result = await runVerification(provider, plain);
    if (!result.ok) {
      res.status(400).json({ success: false, error: result.detail });
      return;
    }

    const secretKeys = def.fields.filter((f) => f.secret).map((f) => f.key);
    const stored = encryptCredentials(plain, secretKeys);

    const integration = await Integration.findOneAndUpdate(
      { workspaceId: req.workspaceId, provider },
      {
        workspaceId: req.workspaceId,
        provider,
        status: 'connected',
        credentials: stored,
        metadata: {
          mode: def.mode,
          verifiedAt: new Date().toISOString(),
          ...(result.meta || {}),
        },
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, data: publicIntegration(integration), message: result.detail });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── DELETE /api/integrations/:provider — disconnect ──────────────
router.delete('/:provider', authenticate, requireWorkspace, async (req: AuthRequest, res: Response) => {
  try {
    const integration = await Integration.findOneAndDelete({
      workspaceId: req.workspaceId,
      provider: req.params.provider,
    });
    if (!integration) {
      res.status(404).json({ success: false, error: 'Integration not found' });
      return;
    }
    res.json({ success: true, message: 'Integration disconnected' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
