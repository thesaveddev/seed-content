import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Helper: treat empty strings as undefined so defaults apply
const opt = (schema: z.ZodTypeAny) =>
  z.preprocess((v) => (v === '' || v === undefined ? undefined : v), schema);

const envSchema = z.object({
  NODE_ENV: opt(z.enum(['development', 'production', 'test'])).default('development'),
  PORT: opt(z.coerce.number()).default(3001).transform((v) => v || 3001),
  MONGODB_URI: opt(z.string()).default('mongodb://localhost:27017/seed'),
  REDIS_URL: opt(z.string()).default('redis://localhost:6379'),
  JWT_SECRET: opt(z.string().min(10)).default('dev-jwt-secret-change-in-production'),
  JWT_EXPIRES_IN: opt(z.string()).default('7d'),
  AI_PROVIDER: opt(z.enum(['openai', 'anthropic', 'mock'])).default('mock'),
  OPENAI_API_KEY: opt(z.string()).optional(),
  STORAGE_PROVIDER: opt(z.enum(['local', 's3'])).default('local'),
  STORAGE_DIR: opt(z.string()).default('./uploads'),
  FRONTEND_URL: opt(z.string()).default('http://localhost:5173'),
  STRIPE_SECRET_KEY: opt(z.string()).optional(),
  STRIPE_WEBHOOK_SECRET: opt(z.string()).optional(),
  STRIPE_PRICE_CREATOR: opt(z.string()).optional(),
  STRIPE_PRICE_PRO: opt(z.string()).optional(),
  STRIPE_PRICE_AGENCY: opt(z.string()).optional(),
  TELEGRAM_BOT_TOKEN: opt(z.string()).optional(),
  ENCRYPTION_KEY: opt(z.string()).optional(),
  RATE_LIMIT_WINDOW_MS: opt(z.coerce.number()).default(900000),
  RATE_LIMIT_MAX_REQUESTS: opt(z.coerce.number()).default(600),
  RABBITMQ_URL: opt(z.string()).default('amqp://guest:guest@localhost:5672'),
  SMTP_HOST: opt(z.string()).optional(),
  SMTP_PORT: opt(z.coerce.number()).optional(),
  SMTP_USER: opt(z.string()).optional(),
  SMTP_PASS: opt(z.string()).optional(),
  SMTP_FROM: opt(z.string()).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

// ── Production safety checks ─────────────────────────────────────
// Fail fast at startup rather than running insecurely in production.
if (parsed.data.NODE_ENV === 'production') {
  const fatal: string[] = [];
  const warnings: string[] = [];

  if (!parsed.data.JWT_SECRET || parsed.data.JWT_SECRET === 'dev-jwt-secret-change-in-production') {
    fatal.push('JWT_SECRET must be set to a strong random value (e.g. `openssl rand -hex 32`).');
  }

  if (!parsed.data.SMTP_HOST || !parsed.data.SMTP_USER || !parsed.data.SMTP_PASS) {
    fatal.push('SMTP_HOST / SMTP_USER / SMTP_PASS must be configured — without them password-reset emails are never delivered.');
  }

  if (!parsed.data.STRIPE_SECRET_KEY) {
    warnings.push('STRIPE_SECRET_KEY is not set — billing will not charge anyone.');
  } else if (!parsed.data.STRIPE_PRICE_CREATOR || !parsed.data.STRIPE_PRICE_PRO || !parsed.data.STRIPE_PRICE_AGENCY) {
    fatal.push('STRIPE_PRICE_CREATOR / STRIPE_PRICE_PRO / STRIPE_PRICE_AGENCY must all be set — otherwise checkout silently upgrades plans without payment.');
  }

  if (parsed.data.FRONTEND_URL.includes('localhost')) {
    warnings.push('FRONTEND_URL points at localhost — set it to your real domain for OAuth/callbacks to work.');
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  Production configuration warnings:');
    warnings.forEach((w) => console.warn(`   • ${w}`));
  }

  if (fatal.length > 0) {
    console.error('\n❌ Refusing to start in production:');
    fatal.forEach((f) => console.error(`   • ${f}`));
    process.exit(1);
  }
}

export const config = parsed.data;
