# Seed

> **Create once. Repurpose everywhere.**

An AI Content Repurposing SaaS that turns one piece of content into platform-ready content for multiple platforms.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│               React + Vite + TypeScript + Tailwind           │
│                                                              │
│  Landing → Auth → Onboarding → Dashboard → Create → Review   │
└─────────────────────────┬───────────────────────────────────┘
                          │ REST API
┌─────────────────────────┴───────────────────────────────────┐
│                        Backend                               │
│                Express + TypeScript + MongoDB                │
│                                                              │
│  Auth → Workspace → Content → AI Pipeline → Generation       │
│                                                              │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
│  │ MongoDB  │  │  Redis   │  │ BullMQ   │  │  AI Provider │  │
│  │ (data)   │  │ (cache)  │  │ (queue)  │  │ (OpenAI/mck) │  │
│  └─────────┘  └──────────┘  └──────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Content Processing Pipeline

```
User uploads content
        ↓
  Create project + queue job (BullMQ)
        ↓
  Worker picks up job
        ↓
  Transcription (Whisper / Mock)
        ↓
  Content Analysis (AI → structured JSON)
        ↓
  Platform Generation (per-platform prompts)
        ↓
  Quality Check (factual consistency, tone)
        ↓
  Content Pack ready → User reviews/edits
```

## Tech Stack

### Backend
- **Runtime**: Node.js + TypeScript
- **Framework**: Express
- **Database**: MongoDB (Mongoose)
- **Cache/Queue**: Redis + BullMQ
- **Auth**: JWT + bcrypt
- **AI**: OpenAI (with mock provider for dev)
- **Validation**: Zod
- **Storage**: Local (S3-ready abstraction)

### Frontend
- **Framework**: React 18
- **Build**: Vite
- **Styling**: Tailwind CSS
- **State**: Zustand
- **Routing**: React Router v6
- **Icons**: Lucide React
- **Notifications**: React Hot Toast

## Database Models

| Model | Purpose |
|-------|---------|
| User | Auth, profile, onboarding data |
| Workspace | Multi-tenancy, plan management |
| WorkspaceMember | Roles (owner/admin/member/viewer) |
| BrandVoice | Voice configuration per workspace |
| ContentProject | Source content + analysis + status |
| GeneratedContent | Platform-specific generated content |
| Campaign | Groups related content projects |
| ContentIdea | Idea tracking and planning |
| Integration | Social platform connections |
| Usage | Monthly usage tracking |

## API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/register | Register user + workspace |
| POST | /api/auth/login | Login |
| POST | /api/auth/logout | Logout |
| GET | /api/auth/me | Get current user |
| POST | /api/auth/forgot-password | Request password reset |
| POST | /api/auth/reset-password | Reset password |
| PUT | /api/auth/onboarding | Save onboarding data |

### Content
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/content | List projects |
| POST | /api/content | Create project (file upload) |
| POST | /api/content/text | Create from pasted text |
| GET | /api/content/:id | Get project + generated content |
| GET | /api/content/:id/status | Get processing status |
| POST | /api/content/:id/generate | Regenerate all |
| POST | /api/content/:id/regenerate/:platform | Regenerate for platform |
| PUT | /api/content/:id/transcript | Edit transcript |
| PUT | /api/content/:generatedId/content | Update generated content |
| POST | /api/content/:id/rewrite | AI rewrite |
| DELETE | /api/content/:id | Delete project |

### Other
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | /api/workspaces | Workspace CRUD |
| GET/POST/PUT/DELETE | /api/brand-voices | Brand voice CRUD |
| GET/POST/PUT/DELETE | /api/campaigns | Campaign CRUD |
| GET/POST/PUT/DELETE | /api/ideas | Content ideas CRUD |
| GET | /api/stats | Dashboard statistics |
| GET | /api/billing/plans | Available plans |
| GET | /api/billing/usage | Current usage |
| POST | /api/billing/checkout | Upgrade plan |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| NODE_ENV | No | development | Environment |
| PORT | No | 3001 | Server port |
| MONGODB_URI | No | mongodb://localhost:27017/seed | MongoDB connection |
| REDIS_URL | No | redis://localhost:6379 | Redis connection |
| RABBITMQ_URL | No | amqp://guest:guest@localhost:5672 | RabbitMQ (for queue) |
| JWT_SECRET | Yes* | dev-secret | JWT signing secret |
| JWT_EXPIRES_IN | No | 7d | Token expiry |
| AI_PROVIDER | No | mock | AI provider (openai/mock) |
| OPENAI_API_KEY | No | - | OpenAI API key |
| STORAGE_PROVIDER | No | local | Storage (local/s3) |
| STORAGE_DIR | No | ./uploads | Upload directory |
| FRONTEND_URL | No | http://localhost:5173 | Frontend URL for CORS |
| STRIPE_SECRET_KEY | No | - | Stripe secret key |
| TELEGRAM_BOT_TOKEN | No | - | Telegram bot token |
| PUBLIC_BASE_URL | No | http://localhost:3001 | Public origin for OAuth callbacks + media links |
| MEDIA_SIGNING_SECRET | No | - | HMAC key for public media URLs (falls back to JWT_SECRET) |
| LINKEDIN_CLIENT_ID / _SECRET | No | - | LinkedIn OAuth app (enables "Connect with LinkedIn") |
| X_CLIENT_ID / _SECRET | No | - | X OAuth app (enables "Connect with X") |
| INSTAGRAM_CLIENT_ID / _SECRET | No | - | Meta/Facebook OAuth app (enables "Connect with Instagram") |
| YOUTUBE_CLIENT_ID / _SECRET | No | - | Google OAuth client (enables "Connect with YouTube") |
| TIKTOK_CLIENT_ID / _SECRET | No | - | TikTok OAuth app (enables "Connect with TikTok") |
| RATE_LIMIT_WINDOW_MS | No | 900000 | Rate limit window |
| RATE_LIMIT_MAX_REQUESTS | No | 100 | Max requests per window |

## How to Run Locally

### Prerequisites
- Node.js 18+
- Docker (optional — only needed for production-like setup)

### Quick Start (zero external dependencies)
```bash
npm install --prefix server
npm install --prefix web
cp .env.example .env
npm run dev:server   # API on :3001 (in-memory DB + in-process queue)
npm run dev:web      # Frontend on :5173 (proxies to API)
```

The app works out of the box with:
- **In-memory database** — no MongoDB needed
- **In-process queue** — no Redis needed
- **Mock AI provider** — no OpenAI key needed

### With Docker (production-like)
```bash
docker-compose up -d   # Start MongoDB, Redis, RabbitMQ
cp .env.example .env
npm run dev:server
npm run dev:web
```

The app will be available at:
- Frontend: http://localhost:5173
- API: http://localhost:3001
- Health: http://localhost:3001/api/health

### Using Real AI
Set `AI_PROVIDER=openai` and provide `OPENAI_API_KEY` in your `.env` file. The app will automatically use OpenAI for transcription, content analysis, and generation.

## How Workers Work

Workers process content asynchronously via BullMQ:

1. API creates a project and enqueues a job
2. Worker picks up the job
3. Runs through: Transcribe → Analyse → Generate → Quality Check
4. Updates project status at each stage
5. Frontend polls `/api/content/:id/status` every 2 seconds
6. When status becomes `ready`, frontend fetches generated content

## Billing Plans

| Plan | Price | Projects/mo | Platforms | Brand Voices |
|------|-------|-------------|-----------|-------------|
| Free | £0 | 3 | 3 | 1 |
| Creator | £9 | 30 | All | 3 |
| Pro | £19 | 100 | All | 10 |
| Agency | £59 | 500 | All | Unlimited |

## Platform Generation Details

| Platform | Output |
|----------|--------|
| LinkedIn | Post (hook/body/insight/CTA) |
| X | Short post + thread (5-8 tweets) |
| Instagram | Caption + first-line hook + hashtags |
| TikTok | Caption + hook + CTA + on-screen text |
| YouTube | 5 titles + description + keywords |
| Threads | Conversational post |
| Newsletter | Subject lines + preview + email body |
| Blog | SEO title + meta + H1 + article + keywords |

## What Remains to Configure

1. **OpenAI API Key** — Set `AI_PROVIDER=openai` + `OPENAI_API_KEY` for real content generation
2. **Stripe** — Add Stripe keys for payment processing
3. **Social Integrations** — OAuth flows for direct publishing
4. **Telegram Bot** — Set `TELEGRAM_BOT_TOKEN` for bot functionality
5. **S3 Storage** — Configure for production file storage
6. **Email Service** — For password reset emails (currently logs tokens)

## Known Limitations

- File uploads stored locally (S3 configured but needs credentials)
- Mock AI generates template content (OpenAI key needed for real generation)
- No OAuth integrations yet (architecture ready for Google, Apple)
- Telegram bot is architecture-only (set TELEGRAM_BOT_TOKEN to activate)
- Email sending needs SMTP config (defaults to console logging)
- No social publishing yet (architecture ready, needs platform OAuth)
- Stripe checkout works in dev (direct upgrade); needs keys for real payments

## What's Already Working

- ✅ Authentication (register, login, logout, password reset)
- ✅ Multi-tenant workspaces with role-based access
- ✅ Content upload (video/audio) and text paste
- ✅ In-process content processing pipeline
- ✅ AI content analysis and multi-platform generation
- ✅ Real-time status updates via SSE (with polling fallback)
- ✅ Content editing, regeneration, and copy
- ✅ Brand voice management
- ✅ Campaigns and content ideas
- ✅ Billing plan display and usage tracking
- ✅ Stripe integration (checkout + webhooks)
- ✅ Responsive UI with mobile support
- ✅ Error boundary for graceful error handling

## Recommended Next Steps

1. **Add OpenAI API key** for real content generation
2. **Configure Stripe** for payment processing
3. **Add social OAuth** for direct publishing
4. **Deploy** to production (Vercel + Railway or similar)
5. **Add monitoring** (Sentry, analytics)
6. **Implement Content Radar** (AI-powered content suggestions)
7. **Add team collaboration** features
8. **Set up S3** for production file storage
9. **Configure SMTP** for production email sending
