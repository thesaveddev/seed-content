import { Link } from 'react-router-dom';

interface Section {
  heading: string;
  body: string[];
}

const privacySections: Section[] = [
  {
    heading: '1. What we collect',
    body: [
      'Account information: your name, email address, and password (stored only as a secure hash). We never see or store your plaintext password.',
      'Workspace and usage data: the projects, content packs, brand voices, campaigns, scheduled posts, and integrations you create, so the product works and you can return to your work.',
      'Content you submit: any video, audio, or text you upload or paste, and files you attach. This content is processed to generate your content packs.',
      'Third-party credentials you provide (for example, a Telegram bot token or platform access token when you connect an integration). These are encrypted at rest with AES-256-GCM and are never returned in full by the API.',
      'Payment information: handled entirely by Stripe. We never receive or store your card details.',
      'AI keys you provide (BYOK): if you supply your own OpenAI API key in Settings, it is stored encrypted at rest and used only to run your requests.',
    ],
  },
  {
    heading: '2. How we use your data',
    body: [
      'To operate the service: transcribe uploads, generate content packs, enforce plan limits, process billing, and send service notifications (for example, when a scheduled post is published).',
      'To support you: respond to requests and troubleshoot problems you report.',
      'To keep the service safe: rate limiting, abuse prevention, and enforcing our Terms of Service.',
      'We do not sell your personal data, and we do not use your content to train AI models.',
    ],
  },
  {
    heading: '3. AI processing',
    body: [
      'Your content is sent to AI providers to generate your content packs. If you have connected your own OpenAI key (BYOK), your content is processed under your OpenAI account and its terms. Otherwise, processing runs under our provider agreement.',
      'Uploaded source files are used solely to produce your content pack. You can delete a project at any time from your content library, which removes the generated content; you can also contact us to request deletion of your account and associated data.',
    ],
  },
  {
    heading: '4. Sharing and processors',
    body: [
      'We share data only with the processors needed to run the service: our hosting and database providers, Stripe (payments), our email provider (transactional email such as password resets), and the AI provider used for generation (or your own provider when you use BYOK).',
      'We may disclose information if required by law, regulation, or valid legal process.',
    ],
  },
  {
    heading: '5. Data retention and deletion',
    body: [
      'We keep your data while your account is active. Uploaded files and generated content remain available until you delete them.',
      'You can request deletion of your account and personal data at any time by contacting us. We will delete your data within 30 days, except where retention is required by law (for example, billing records).',
    ],
  },
  {
    heading: '6. Security',
    body: [
      'Passwords are hashed, sessions use signed tokens, uploaded files require authentication, and third-party credentials are encrypted at rest. No service is perfectly secure; if a breach affects your data, we will notify you.',
    ],
  },
  {
    heading: '7. Your rights',
    body: [
      'Depending on where you live, you may have rights to access, correct, export, or delete your personal data, and to object to or restrict certain processing. Contact us to exercise any of these rights.',
    ],
  },
  {
    heading: '8. Changes and contact',
    body: [
      'We will post any changes to this policy on this page. Material changes will be announced in the app.',
      'Questions? Contact us through the app or at the support address listed on our website.',
    ],
  },
];

const termsSections: Section[] = [
  {
    heading: '1. Agreement',
    body: [
      'By creating an account or using Seed (the "Service"), you agree to these Terms of Service and to our Privacy Policy. If you use the Service on behalf of an organization, you confirm you have authority to bind that organization.',
    ],
  },
  {
    heading: '2. Your account',
    body: [
      'You must provide accurate information, keep your credentials secure, and are responsible for activity under your account. You must be at least 16 years old to use the Service.',
      'Workspaces may have multiple members with different roles. Workspace owners are responsible for their members\u2019 use of the workspace.',
    ],
  },
  {
    heading: '3. Acceptable use',
    body: [
      'You agree not to: use the Service to generate or distribute unlawful, infringing, deceptive, harassing, or harmful content; impersonate others or misrepresent AI-generated material as human-written where disclosure is required; scrape, reverse-engineer, or overload the Service; resell access without a plan that permits it; or upload content you have no right to use.',
      'We may suspend or terminate accounts that violate these rules or that create legal or security risk for us or others.',
    ],
  },
  {
    heading: '4. Your content',
    body: [
      'You retain ownership of the content you upload and the content generated for you. You grant us a limited licence to store, process, and transmit that content solely to provide the Service.',
      'You are responsible for ensuring you have the rights to the source material you upload, and for reviewing generated content before publishing it anywhere.',
      'You are responsible for how you use third-party publishing integrations, including complying with each platform\u2019s own terms and automation rules.',
    ],
  },
  {
    heading: '5. Plans, billing and cancellation',
    body: [
      'Free plans are subject to the usage limits shown in the app. Paid plans bill monthly in advance through Stripe and renew automatically until cancelled.',
      'You can cancel at any time from the billing portal; cancellation takes effect at the end of the current billing period. Prices may change with reasonable notice.',
      'Payments are non-refundable except where required by law or where we decide otherwise in good faith.',
    ],
  },
  {
    heading: '6. Third-party services and integrations',
    body: [
      'The Service relies on third parties (hosting, AI providers, payment processing, and any platforms you connect). Their availability, changes, or outages may affect features. Connecting an integration means you also accept that platform\u2019s terms.',
    ],
  },
  {
    heading: '7. Availability and changes',
    body: [
      'We aim for high availability but do not guarantee uninterrupted service. We may add, change, or discontinue features; if we discontinue a material feature on a paid plan, we will give you notice.',
    ],
  },
  {
    heading: '8. Disclaimers and liability',
    body: [
      'The Service is provided "as is" without warranties of any kind. Generated content may contain errors — always review before publishing. To the maximum extent permitted by law, our aggregate liability is limited to the amounts you paid us in the 12 months before the claim, and we are not liable for indirect or consequential losses.',
    ],
  },
  {
    heading: '9. Termination',
    body: [
      'You may stop using the Service and delete your account at any time. We may suspend or terminate access for breach of these terms, non-payment, or lawful request, with notice where practicable.',
    ],
  },
  {
    heading: '10. Changes to these terms',
    body: [
      'We may update these terms; the current version is always on this page with its effective date. Continued use after changes take effect means you accept them.',
    ],
  },
];

const effectiveDate = 'September 12, 2026';

export default function LegalPage({ type }: { type: 'privacy' | 'terms' }) {
  const isPrivacy = type === 'privacy';
  const sections = isPrivacy ? privacySections : termsSections;
  const title = isPrivacy ? 'Privacy Policy' : 'Terms of Service';

  return (
    <main
      className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20"
      style={{ background: 'var(--color-paper)', color: 'var(--color-ink)' }}
    >
      <nav className="mb-10 text-sm" style={{ color: 'var(--color-muted)' }}>
        <Link to="/" className="hover:underline">
          ← Back to Seed
        </Link>
      </nav>

      <h1
        className="text-3xl font-bold tracking-tight sm:text-4xl"
        style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}
      >
        {title}
      </h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--color-muted)' }}>
        Effective date: {effectiveDate}
      </p>

      <div className="mt-10 space-y-8">
        {sections.map((section) => (
          <section key={section.heading}>
            <h2
              className="text-lg font-bold"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {section.heading}
            </h2>
            <div className="mt-2 space-y-2 text-sm leading-relaxed" style={{ color: 'var(--color-ink-2)' }}>
              {section.body.map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div
        className="mt-14 flex flex-wrap gap-4 border-t pt-6 text-sm"
        style={{ borderColor: 'var(--color-rule)' }}
      >
        <Link
          to={isPrivacy ? '/terms' : '/privacy'}
          className="font-medium hover:underline"
          style={{ color: 'var(--color-accent)' }}
        >
          {isPrivacy ? 'Read our Terms of Service' : 'Read our Privacy Policy'}
        </Link>
      </div>
    </main>
  );
}
