# Design — Seed

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

## Genre
editorial

## Macrostructure family
- Marketing pages: Marquee Hero (nav N6 masthead, footer Ft1 mast-headed)
- App pages: Workbench (function-first, no enrichment)
- Content pages: Long Document (continuous prose feel)

## Theme
Custom — "editorial precision, indigo ink, no varnish"

- `--color-paper`   oklch(97% 0.010 270)
- `--color-paper-2` oklch(94% 0.012 270)
- `--color-paper-3` oklch(91% 0.014 270)
- `--color-ink`     oklch(18% 0.014 270)
- `--color-ink-2`   oklch(36% 0.012 270)
- `--color-rule`    oklch(84% 0.012 270)
- `--color-rule-2`  oklch(88% 0.010 270)
- `--color-muted`   oklch(50% 0.010 270)
- `--color-accent`  oklch(52% 0.18 270)
- `--color-accent-ink` oklch(97% 0.010 270)
- `--color-focus`   oklch(50% 0.22 270)

## Typography
- Display: Newsreader, weight 700, style normal
- Body: Source Serif 4, weight 400
- Outlier: Geist Mono, weight 500 (wordmark + hero stat only)
- Display tracking: -0.02em
- Label tracking: 0.08em uppercase
- Type scale anchor: --text-display = clamp(2.75rem, 5vw + 1rem, 5.25rem)
- Scale ratio: 1.25 (major third)

## Spacing
4-point named scale. The values are in `tokens.css`. Pages must use named
tokens (`var(--space-md)`), never raw values.

## Motion
- Easings: cubic-bezier(0.16, 1, 0.3, 1) named `--ease-out`
- Reveal pattern: fade only (no slide on app pages)
- Reduced-motion fallback: opacity-only, ≤ 150 ms.

## Microinteractions stance
- Silent success (no celebratory toasts)
- Hover delay 800 ms on tooltips, 0 ms on focus
- One orchestrated entrance per page section

## CTA voice
- Primary CTA: indigo fill, 6px radius, Newsreader 700
- Secondary CTA: ink border, 6px radius, Source Serif 4 500

## Per-page allowances
- Marketing pages MAY use enrichment (Tier-A CSS art only)
- App pages MUST NOT use enrichment — function carries the page
- Content pages: typography only

## What pages MUST share
- The wordmark in Newsreader 700
- The accent colour and its placement (≤ 5% per viewport)
- The display + body fonts
- The CTA voice (button shape, border-radius, padding rhythm)
- Hairline rules, not card borders

## What pages MAY differ on
- Macrostructure within the page-type family
- Hero archetype (within the family's allowance)
- Enrichment — only on marketing pages, only Tier-A
