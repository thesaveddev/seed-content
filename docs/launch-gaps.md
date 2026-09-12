# Launch-Gap Audit — September 12, 2026

Re-run of the launch-gap audit. Items from the previous audit are **done** —
automated tests (server + web), CI, legal pages, landing SEO, admin story,
OAuth connect flow, token lifecycle, public media hosting, and the retry
mechanism (see git history and `docs/auto-publishing-roadmap.md`). This is
what remains between here and a public launch.

## Snapshot

| Area | State |
|---|---|
| Tests | ✅ 94 server + 39 web; coverage thresholds enforced in CI (server 61/65/64/61, web 21/70/39/21) |
| CI | ✅ Green: typecheck → tests with coverage → build, reports as artifacts |
| Legal | ✅ `/privacy` + `/terms` (Stripe live-mode requirement met) |
| SEO | ✅ Meta/OG/Twitter tags, JSON-LD, `og-image.png`, `robots.txt`, `sitemap.xml`, `_redirects` |
| Admin | ✅ `/api/admin/*` + `/admin` page, last-admin protection, account disable |
| Auto-publish | ✅ Code done — Telegram + X live; LinkedIn/Instagram activate with app credentials |
| Deploy artifacts | ✅ `Dockerfile` (multi-stage) + `docker-compose.yml` (mongodb/redis/rabbitmq/app/uploads) |

---

## Remaining gaps, ranked by launch impact

### 1. Production deployment (blocks everything user-facing)
Everything works locally; nothing is deployed. Needed: a host for the
Docker image, managed MongoDB + Redis, and the environment wired
(`JWT_SECRET`, `SMTP_*`, `STRIPE_*`, `PUBLIC_BASE_URL`, `ENCRYPTION_KEY`).
`ENV 🔴` — needs your hosting/domain decisions; the compose file is the
starting point.

### 2. Billing end-to-end untested against real Stripe (high)
`billing.ts` route coverage is 35%. Checkout/webhook paths are typed and
signature-verified (`constructEvent`) but only exercised against the Stripe
test CLI locally. Before charging real cards: a staged run of
checkout → `invoice.paid` webhook → plan flip → customer portal → cancel /
uncancel. **Owner: you + me (needs your Stripe account).**

### 3. Observability (medium-high)
No error tracking (Sentry or similar), no uptime monitoring on
`/health`, no log retention. First production incident will be invisible.
Fast to add: Sentry DSNs for server + web, an uptime monitor, and a
log drain.

### 4. Content routes are the least-tested core path (medium)
`content.ts` sits at 28% coverage despite being the product's core. The
pipeline itself is e2e-tested, but URL import, export, regenerate,
rewrite, and transcript-update branches are not. Also untested low but
important routes: `scheduler.ts` 28%, `stats.ts` 26%, `ideas.ts` 29%,
`brandVoice.ts` 24%, `events.ts` (SSE) 26%. Next coverage ratchets live here.

### 5. Ops hardening (medium)
- No `HEALTHCHECK` in the Dockerfile; no `SIGTERM`/`SIGINT` graceful
  shutdown in `server/src/index.ts` (in-flight publishes could be cut
  mid-flight on redeploy).
- No documented MongoDB backup story (frequency, retention, restore test).
- `.env.example` is current, but the deploy checklist (which values are
  required vs optional in production) should live in `docs/`.

### 6. Platform app approvals (external, start now — long lead times)
Per `docs/auto-publishing-roadmap.md`: LinkedIn "Share on LinkedIn"
product approval, Meta App Review (Instagram/Threads), Google verification,
TikTok client audit, and the X tier cost decision. Each app is
identity-bound — these are **your** accounts; I can pair on setup and then
flip the env keys. No code work remains for LinkedIn/Instagram beyond
credentials.

### 7. Small product polish (low, post-launch ok)
- Welcome/onboarding email and a weekly digest of scheduled posts
  (`SMTP` is already a production requirement, so the transport exists).
- Public waitlist/early-access gate if you want a soft launch.

---

## Suggested next actions

1. Pick a host + domain → deploy the compose stack → smoke-test.
2. I stage the Stripe end-to-end test with your test keys.
3. I add Sentry + uptime monitoring + graceful shutdown (no input needed).
4. You start the platform developer-app registrations (longest lead time).
