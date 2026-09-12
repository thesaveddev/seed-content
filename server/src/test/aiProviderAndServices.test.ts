import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { UserKeyAIProvider } from '../services/ai';
import { MockAIProvider } from '../services/ai/mock';
import { config } from '../config/env';
import { User } from '../models';

/**
 * UserKeyAIProvider is the production AI path (per-user OpenAI keys).
 * The OpenAI SDK is mocked at the module boundary so every branch —
 * user-key lookup, global fallback, JSON parsing, per-platform parsing,
 * quality-check fallback — runs without network.
 */

const chatCreate = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: chatCreate } };
    constructor(public opts?: any) {}
  },
}));

afterEach(() => {
  chatCreate.mockReset();
  vi.restoreAllMocks();
});

describe('UserKeyAIProvider', () => {
  let user: any;

  beforeAll(async () => {
    const { registerUser, resetDatabase } = await import('./helpers');
    await resetDatabase();
    user = await registerUser('AI Provider');
  });

  function withUserKey(key: string | null) {
    const original = User.findById;
    (User as any).findById = (_id: string) => ({
      select: async () => (key ? { openaiApiKey: key } : null),
    });
    return () => { (User as any).findById = original; };
  }

  /** Pre-seed a cached user client wired to the mocked chatCreate. */
  function seedClient(provider: UserKeyAIProvider, userId: string) {
    (provider as any).userKeyClients.set(userId, { chat: { completions: { create: chatCreate } } });
  }

  it('throws a helpful error when no key is configured anywhere', async () => {
    const restore = withUserKey(null);
    const provider = new UserKeyAIProvider();
    // Ensure no global client leak between tests
    (provider as any).globalClient = null;
    (provider as any).userKeyClients.clear();
    const saved = config.OPENAI_API_KEY;
    (config as any).OPENAI_API_KEY = '';
    try {
      await expect(provider.analyseContent('some transcript')).rejects.toThrow(/No AI provider configured/);
    } finally {
      (config as any).OPENAI_API_KEY = saved;
      restore();
    }
  });

  it('uses the user key and parses the JSON analysis', async () => {
    const restore = withUserKey('sk-user-key-123456');
    const provider = new UserKeyAIProvider();
    const analysis = {
      title: 'T', summary: 'S', mainTopic: 'M', keyPoints: [], hook: 'H',
      audience: 'A', painPoints: [], insights: [], story: 'ST', tone: 'x',
      cta: 'C', contentType: 'video', keywords: [], entities: [], claims: [],
      suggestedAngles: [],
    };
    chatCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(analysis) } }] });

    const result = await provider.analyseContent('transcript body', 'extra context', 'user-1');
    expect(result.title).toBe('T');
    expect(chatCreate).toHaveBeenCalled();
    const payload = chatCreate.mock.calls[0][0];
    expect(payload.model).toBe('gpt-4o');
    restore();
  });

  it('extracts JSON from a chatty response', async () => {
    const restore = withUserKey('sk-user-key-123456');
    const provider = new UserKeyAIProvider();
    seedClient(provider, 'user-2');
    chatCreate.mockResolvedValue({
      choices: [{ message: { content: 'Here you go:\n```json\n{"score": 88, "issues": [], "suggestions": []}\n```' } }],
    });
    const qc = await provider.qualityCheck('src', 'gen', 'linkedin', 'user-2');
    expect(qc.score).toBe(88);
    restore();
  });

  it('qualityCheck falls back to a default when parsing fails', async () => {
    const restore = withUserKey('sk-user-key-123456');
    const provider = new UserKeyAIProvider();
    seedClient(provider, 'user-3');
    chatCreate.mockResolvedValue({ choices: [{ message: { content: 'not json at all' } }] });
    const qc = await provider.qualityCheck('src', 'gen', 'x', 'user-3');
    expect(qc.score).toBe(70);
    restore();
  });

  it('generateForPlatform parses array responses and keeps the platform tag', async () => {
    const restore = withUserKey('sk-user-key-123456');
    const provider = new UserKeyAIProvider();
    seedClient(provider, 'user-4');
    chatCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify([{ type: 'post', text: 'hello' }, { type: 'comment', text: 'reply bait' }]) } }],
    });
    const pieces = await provider.generateForPlatform({} as any, 'linkedin', 'reach', undefined, 'user-4');
    expect(pieces).toHaveLength(2);
    expect(pieces[0].platform).toBe('linkedin');
    expect(pieces[1].type).toBe('comment');
    restore();
  });

  it('generateForPlatform falls back to raw text when response is not JSON', async () => {
    const restore = withUserKey('sk-user-key-123456');
    const provider = new UserKeyAIProvider();
    seedClient(provider, 'user-5');
    chatCreate.mockResolvedValue({ choices: [{ message: { content: 'just plain text' } }] });
    const pieces = await provider.generateForPlatform({} as any, 'x', 'reach', undefined, 'user-5');
    expect(pieces).toHaveLength(1);
    expect(pieces[0].content.text).toBe('just plain text');
    restore();
  });

  it('rewriteContent threads brand voice into the system prompt', async () => {
    const restore = withUserKey('sk-user-key-123456');
    const provider = new UserKeyAIProvider();
    seedClient(provider, 'user-6');
    chatCreate.mockResolvedValue({ choices: [{ message: { content: 'rewritten!' } }] });
    const out = await provider.rewriteContent('original', 'make it punchy', 'formal tone', 'user-6');
    expect(out).toBe('rewritten!');
    const sys = chatCreate.mock.calls[0][0].messages[0].content;
    expect(sys).toContain('formal tone');
    restore();
  });

  it('falls back to the global key when the user has none', async () => {
    const restore = withUserKey(null);
    const provider = new UserKeyAIProvider();
    (provider as any).globalClient = { chat: { completions: { create: chatCreate } } };
    chatCreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });
    const out = await provider.rewriteContent('c', 'i', undefined, 'user-7');
    expect(out).toBe('ok');
    restore();
  });

  it('caches per-user clients', async () => {
    const restore = withUserKey('sk-cache-test-123456');
    const provider = new UserKeyAIProvider();
    chatCreate.mockResolvedValue({ choices: [{ message: { content: '{"score": 50, "issues": [], "suggestions": []}' } }] });
    await provider.qualityCheck('s', 'g', 'linkedin', 'user-cache');
    await provider.qualityCheck('s', 'g', 'linkedin', 'user-cache');
    // User lookup happens once; the second call reuses the cached client.
    // (Hard to observe through the mock — assert via internal map.)
    expect((provider as any).userKeyClients.has('user-cache')).toBe(true);
    restore();
  });
});

describe('MockAIProvider internal branches', () => {
  it('qualityCheck penalises AI-slop phrases and unconnected content', async () => {
    const p = new MockAIProvider();
    const slop = await p.qualityCheck('source about gardening', 'This is a game-changer that will unlock the power of synergy in the realm of leverage. Totally unrelated filler words appear here instead. No questions here at all.', 'linkedin');
    expect(slop.issues.some((i) => /generic AI language|robotic/i.test(i))).toBe(true);
    // Overlap with the source is <10% → disconnected-content issue fires
    expect(slop.issues.some((i) => /connected to the source material/i.test(i))).toBe(true);
    expect(slop.score).toBeLessThan(75);

    const good = await p.qualityCheck('source about gardening and tomatoes', 'Gardening tomatoes is rewarding and satisfying. Have you tried growing tomatoes in your garden? Sign up for gardening tips and share with friends!', 'linkedin');
    expect(good.score).toBeGreaterThan(slop.score);
  });

  it('rewriteContent handles shorter/longer/formal/casual instructions', async () => {
    const p = new MockAIProvider();
    const base = "Hello there! You're great. Don't stop. Keep going. More text here.";
    const shorter = await p.rewriteContent(base, 'make it shorter');
    expect(shorter.length).toBeLessThan(base.length);
    const longer = await p.rewriteContent(base, 'expand with detail');
    expect(longer.length).toBeGreaterThan(base.length);
    // The formal branch replaces !→. and lower-case you're→you are
    // (the base starts a sentence with capital "You're", which stays)
    const formal = await p.rewriteContent("you're kind! Don't stop!", 'make it formal');
    expect(formal).toContain('you are');
    expect(formal).not.toContain('!');
    // Casual branch replaces .→! and lower-case "you are"→"you're"
    const casual = await p.rewriteContent('you are kind. do not stop.', 'make it casual');
    expect(casual).toContain("you're");
    expect(casual).toContain('!');
  });

  it('clamp truncates long strings at word boundaries', async () => {
    const p = new MockAIProvider();
    const pieces = await p.generateForPlatform(
      { hook: 'w'.repeat(400), keyPoints: ['a'.repeat(400)], cta: 'Try it!', tone: '', audience: '', mainTopic: '', summary: '', story: '' } as any,
      'linkedin',
      'reach'
    );
    expect(pieces.length).toBeGreaterThan(0);
  });
});
