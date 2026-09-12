import { Link } from 'react-router-dom';
import { ArrowRight, Zap, Check, ChevronRight } from 'lucide-react';

const platforms = [
  { name: 'LinkedIn', icon: '💼', style: { background: 'oklch(95% 0.03 240)', color: 'oklch(35% 0.08 240)' } },
  { name: 'X', icon: '𝕏', style: { background: 'var(--color-paper-2)', color: 'var(--color-ink)' } },
  { name: 'Instagram', icon: '📸', style: { background: 'oklch(95% 0.03 340)', color: 'oklch(40% 0.10 340)' } },
  { name: 'TikTok', icon: '🎵', style: { background: 'var(--color-paper-2)', color: 'var(--color-ink)' } },
  { name: 'YouTube', icon: '▶️', style: { background: 'oklch(95% 0.03 25)', color: 'oklch(40% 0.12 25)' } },
  { name: 'Threads', icon: '🧵', style: { background: 'oklch(95% 0.03 300)', color: 'oklch(35% 0.10 300)' } },
  { name: 'Newsletter', icon: '📧', style: { background: 'oklch(95% 0.03 75)', color: 'oklch(40% 0.10 75)' } },
  { name: 'Blog', icon: '✍️', style: { background: 'oklch(95% 0.03 145)', color: 'oklch(35% 0.10 145)' } },
];

const steps = [
  { num: '1', title: 'Drop your content', desc: 'Upload a video, paste text, or share a link.' },
  { num: '2', title: 'Choose your goal', desc: 'Reach, authority, or conversion.' },
  { num: '3', title: 'Get your content pack', desc: 'Platform-native content ready to publish.' },
];

const useCases = [
  { title: 'Creators', desc: 'Turn one video into a week of content across every platform.', icon: '🎬' },
  { title: 'Founders', desc: 'Share your story everywhere without spending hours rewriting.', icon: '🚀' },
  { title: 'Agencies', desc: 'Deliver more content for clients without scaling your team.', icon: '🏢' },
  { title: 'Businesses', desc: 'Maximize every piece of content you create.', icon: '📈' },
];

const faqs = [
  { q: 'What content can I upload?', a: 'Currently you can upload video files (MP4, MOV, WEBM), audio files (MP3, WAV, M4A), or paste text directly. We\'re adding URL import soon.' },
  { q: 'Does it copy my content?', a: 'No. Our AI understands your content\'s message, tone, and structure, then rewrites it natively for each platform while preserving your voice.' },
  { q: 'Can I edit generated content?', a: 'Absolutely. Every piece of generated content is fully editable. You can also use our AI editing tools to refine it further.' },
  { q: 'Can I publish directly?', a: 'Direct publishing is coming soon. For now, you can copy content to your clipboard or export it.' },
  { q: 'How does AI use my content?', a: 'Your uploaded content is used solely to generate your content pack. We don\'t train on your data. AI providers process content according to their configured policies.' },
  { q: 'What happens to uploaded files?', a: 'Uploaded files are stored securely and can be deleted at any time from your content library.' },
  { q: 'What platforms are supported?', a: 'LinkedIn, X (Twitter), Instagram, TikTok, YouTube, Threads, Newsletter (email), and Blog. We\'re adding more.' },
];

const plans = [
  { name: 'Free', price: '£0', features: ['3 projects/month', '3 platforms', '1 brand voice'] },
  { name: 'Creator', price: '£9/mo', features: ['30 projects/month', 'All platforms', '3 brand voices', '10 campaigns'], popular: true },
  { name: 'Pro', price: '£19/mo', features: ['100 projects/month', 'All platforms', '10 brand voices', '50 campaigns'] },
  { name: 'Agency', price: '£59/mo', features: ['500 projects/month', 'Unlimited everything', 'Multiple workspaces'] },
];

export default function LandingPage() {
  return (
    <div style={{ background: 'var(--color-paper)', color: 'var(--color-ink)' }}>
      {/* Nav — editorial masthead voice */}
      <nav
        className="sticky top-0 z-50"
        style={{
          background: 'oklch(97% 0.010 270 / 0.92)',
          backdropFilter: 'blur(12px)',
          borderBottom: 'var(--rule-width) solid var(--color-rule)',
        }}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <span
            className="text-xl font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
          >
            Seed
          </span>
          <div className="flex items-center gap-4">
            <Link
              to="/login"
              className="text-sm font-medium transition-colors"
              style={{ color: 'var(--color-ink-2)', fontFamily: 'var(--font-display)' }}
            >
              Log in
            </Link>
            <Link to="/register" className="btn-primary text-sm" style={{ padding: '0.5rem 1rem' }}>
              Start creating free
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero — left-biased, editorial, no badge, no decorative effects */}
      <section style={{ background: 'var(--color-paper)' }}>
        <div className="mx-auto max-w-6xl px-4 pt-24 pb-16 sm:px-6 sm:pt-32 sm:pb-20">
          <div className="max-w-3xl">
            {/* Headline — left-aligned, editorial */}
            <h1
              className="text-4xl font-bold tracking-tight sm:text-6xl"
              style={{
                fontFamily: 'var(--font-display)',
                color: 'var(--color-ink)',
                lineHeight: 1.05,
                letterSpacing: '-0.03em',
              }}
            >
              One piece of content.
              <br />
              <span style={{ color: 'var(--color-accent)' }}>Everywhere.</span>
            </h1>

            {/* Subtitle */}
            <p
              className="mt-6 max-w-lg text-lg sm:text-xl"
              style={{ color: 'var(--color-ink-2)', lineHeight: 1.5 }}
            >
              Turn a video, podcast, post or idea into platform-ready content
              for your entire audience — in minutes.
            </p>

            {/* CTAs */}
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link to="/register" className="btn-primary" style={{ padding: '0.75rem 1.5rem', fontSize: '1rem' }}>
                Start creating free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/register"
                className="btn-secondary"
                style={{ padding: '0.75rem 1.5rem', fontSize: '1rem' }}
              >
                See pricing
              </Link>
            </div>
          </div>

          {/* Platform list — horizontal, editorial, no orbit animation */}
          <div
            className="mt-16 flex flex-wrap items-center gap-3 sm:mt-20"
            style={{ borderTop: 'var(--rule-width) solid var(--color-rule)', paddingTop: 'var(--space-lg)' }}
          >
            <span
              className="mr-2 text-xs font-semibold uppercase tracking-widest"
              style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-display)' }}
            >
              For
            </span>
            {platforms.map((p) => (
              <span
                key={p.name}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium"
                style={{ ...p.style, border: 'var(--rule-width) solid var(--color-rule)' }}
              >
                <span>{p.icon}</span>
                {p.name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Problem — editorial voice, asymmetric */}
      <section style={{ borderTop: 'var(--rule-width) solid var(--color-rule)' }}>
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <div className="max-w-2xl">
            <h2
              className="text-3xl font-bold sm:text-4xl"
              style={{ fontFamily: 'var(--font-display)', lineHeight: 1.1 }}
            >
              You're already creating content.
            </h2>
            <p
              className="mt-4 text-xl"
              style={{ color: 'var(--color-ink-2)' }}
            >
              You're just not getting enough from it.
            </p>
          </div>
        </div>
      </section>

      {/* How it works — editorial prose, not cards */}
      <section style={{ borderTop: 'var(--rule-width) solid var(--color-rule)', background: 'var(--color-paper-2)' }}>
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <h2
            className="text-2xl font-bold sm:text-3xl"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            How it works
          </h2>
          <div className="mt-10 grid gap-12 sm:grid-cols-3" style={{ borderTop: 'var(--rule-width) solid var(--color-rule)', paddingTop: 'var(--space-lg)' }}>
            {steps.map((step, i) => (
              <div key={step.num}>
                <span
                  className="text-xs font-semibold uppercase tracking-widest"
                  style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-display)' }}
                >
                  {step.num}
                </span>
                <h3
                  className="mt-2 text-lg font-bold"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {step.title}
                </h3>
                <p className="mt-2 text-sm" style={{ color: 'var(--color-ink-2)' }}>
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Before / After — editorial two-column */}
      <section style={{ borderTop: 'var(--rule-width) solid var(--color-rule)' }}>
        <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6 sm:py-28">
          <h2
            className="text-2xl font-bold sm:text-3xl mb-12"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            From one video to a full campaign
          </h2>
          <div className="grid gap-8 sm:grid-cols-2" style={{ borderTop: 'var(--rule-width) solid var(--color-rule)', paddingTop: 'var(--space-lg)' }}>
            <div>
              <span
                className="text-xs font-semibold uppercase tracking-widest"
                style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-display)' }}
              >
                Original
              </span>
              <div
                className="mt-3 rounded-lg p-4 text-sm"
                style={{ background: 'var(--color-paper-2)', color: 'var(--color-ink-2)' }}
              >
                <p>"I spent £2,000 building my SaaS MVP and here's what I learned. The biggest lesson wasn't about code — it was about reducing decisions..."</p>
              </div>
              <div className="mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>60-second video</div>
            </div>

            <div>
              <span
                className="text-xs font-semibold uppercase tracking-widest"
                style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-display)' }}
              >
                Generated
              </span>
              <div className="mt-3 space-y-3">
                <div className="rounded-lg p-3 text-xs" style={{ background: 'oklch(95% 0.03 240)', color: 'oklch(35% 0.08 240)' }}>
                  <span className="font-semibold">LinkedIn:</span> Founder story post
                </div>
                <div className="rounded-lg p-3 text-xs" style={{ background: 'var(--color-paper-2)', color: 'var(--color-ink-2)' }}>
                  <span className="font-semibold">X:</span> 5-tweet thread
                </div>
                <div className="rounded-lg p-3 text-xs" style={{ background: 'oklch(95% 0.03 340)', color: 'oklch(40% 0.10 340)' }}>
                  <span className="font-semibold">Instagram:</span> Caption + hooks
                </div>
                <div className="rounded-lg p-3 text-xs" style={{ background: 'oklch(95% 0.03 75)', color: 'oklch(40% 0.10 75)' }}>
                  <span className="font-semibold">Newsletter:</span> Email draft
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Use Cases — editorial, not 4-card grid */}
      <section style={{ borderTop: 'var(--rule-width) solid var(--color-rule)', background: 'var(--color-paper-2)' }}>
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <h2
            className="text-2xl font-bold sm:text-3xl"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Built for everyone creating content
          </h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-2" style={{ borderTop: 'var(--rule-width) solid var(--color-rule)', paddingTop: 'var(--space-lg)' }}>
            {useCases.map((uc) => (
              <div key={uc.title} className="flex gap-4">
                <span className="text-2xl">{uc.icon}</span>
                <div>
                  <h3 className="font-bold" style={{ fontFamily: 'var(--font-display)' }}>{uc.title}</h3>
                  <p className="mt-1 text-sm" style={{ color: 'var(--color-ink-2)' }}>{uc.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing — editorial, not 4-tier comparison */}
      <section style={{ borderTop: 'var(--rule-width) solid var(--color-rule)' }}>
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <h2
            className="text-2xl font-bold sm:text-3xl"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Simple pricing
          </h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4" style={{ borderTop: 'var(--rule-width) solid var(--color-rule)', paddingTop: 'var(--space-lg)' }}>
            {plans.map((plan) => (
              <div key={plan.name}>
                {plan.popular && (
                  <span
                    className="text-xs font-semibold uppercase tracking-widest"
                    style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-display)' }}
                  >
                    Most popular
                  </span>
                )}
                <h3 className="mt-1 text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>{plan.name}</h3>
                <div className="mt-2 text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>{plan.price}</div>
                <ul className="mt-4 space-y-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-ink-2)' }}>
                      <Check className="h-4 w-4" style={{ color: 'var(--color-accent)' }} />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/register"
                  className={`mt-6 inline-block text-sm font-semibold ${plan.popular ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '0.5rem 1rem' }}
                >
                  Get started
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ — editorial, not accordion cards */}
      <section style={{ borderTop: 'var(--rule-width) solid var(--color-rule)', background: 'var(--color-paper-2)' }}>
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-28">
          <h2
            className="text-2xl font-bold sm:text-3xl"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Frequently asked questions
          </h2>
          <div className="mt-10 space-y-0" style={{ borderTop: 'var(--rule-width) solid var(--color-rule)', paddingTop: 'var(--space-md)' }}>
            {faqs.map((faq) => (
              <details key={faq.q} className="group">
                <summary
                  className="flex cursor-pointer items-center justify-between py-4 text-sm font-semibold transition-colors"
                  style={{
                    borderBottom: 'var(--rule-width) solid var(--color-rule)',
                    color: 'var(--color-ink)',
                    fontFamily: 'var(--font-display)',
                    listStyle: 'none',
                  }}
                >
                  {faq.q}
                  <ChevronRight
                    className="h-4 w-4 transition-transform group-open:rotate-90"
                    style={{ color: 'var(--color-muted)' }}
                  />
                </summary>
                <div className="pb-4 text-sm" style={{ color: 'var(--color-ink-2)' }}>
                  {faq.a}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA — editorial */}
      <section style={{ borderTop: 'var(--rule-width) solid var(--color-rule)' }}>
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-28">
          <h2
            className="text-3xl font-bold sm:text-4xl"
            style={{ fontFamily: 'var(--font-display)', lineHeight: 1.1 }}
          >
            Stop creating once and publishing once.
          </h2>
          <Link to="/register" className="btn-primary mt-8 inline-flex text-base" style={{ padding: '0.75rem 1.5rem' }}>
            Create your first content pack
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Footer — editorial colophon */}
      <footer style={{ borderTop: 'var(--rule-width) solid var(--color-rule)' }}>
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-10 sm:flex-row sm:justify-between sm:px-6">
          <span
            className="text-sm font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
          >
            Seed
          </span>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            © 2026 Seed. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
