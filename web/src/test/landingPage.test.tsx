import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LandingPage from '../pages/LandingPage';

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>
  );
}

describe('LandingPage', () => {
  it('renders the hero headline and value proposition', () => {
    renderLanding();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/One piece of content/i);
    expect(screen.getByText(/Everywhere\./i)).toBeInTheDocument();
    expect(
      screen.getByText(/Turn a video, podcast, post or idea into platform-ready content/i)
    ).toBeInTheDocument();
  });

  it('renders primary CTAs that link to registration', () => {
    renderLanding();

    const ctas = screen.getAllByRole('link', { name: /start creating free/i });
    expect(ctas.length).toBeGreaterThanOrEqual(2); // nav + hero
    for (const cta of ctas) {
      expect(cta).toHaveAttribute('href', '/register');
    }
  });

  it('shows all eight supported platforms', () => {
    renderLanding();

    for (const platform of ['LinkedIn', 'Instagram', 'TikTok', 'YouTube', 'Threads', 'Newsletter', 'Blog']) {
      expect(screen.getByText(platform)).toBeInTheDocument();
    }
    // X renders as the unicode glyph inside a chip
    expect(screen.getByText('𝕏')).toBeInTheDocument();
  });

  it('renders the three-step how-it-works flow', () => {
    renderLanding();

    expect(screen.getByText(/Drop your content/i)).toBeInTheDocument();
    expect(screen.getByText(/Choose your goal/i)).toBeInTheDocument();
    expect(screen.getByText(/Get your content pack/i)).toBeInTheDocument();
  });

  it('lists all four pricing tiers with dollar prices', () => {
    renderLanding();

    for (const plan of ['Free', 'Creator', 'Pro', 'Agency']) {
      expect(screen.getByText(plan)).toBeInTheDocument();
    }
    expect(screen.getByText('$0')).toBeInTheDocument();
    expect(screen.getByText('$9/mo')).toBeInTheDocument();
    expect(screen.getByText('$19/mo')).toBeInTheDocument();
    expect(screen.getByText('$59/mo')).toBeInTheDocument();
  });

  it('marks Creator as the popular plan', () => {
    renderLanding();
    expect(screen.getByText(/most popular/i)).toBeInTheDocument();
  });

  it('renders FAQ items as expandable details', () => {
    renderLanding();

    expect(screen.getByText(/What content can I upload\?/i)).toBeInTheDocument();
    expect(screen.getByText(/What platforms are supported\?/i)).toBeInTheDocument();

    const details = document.querySelectorAll('details');
    expect(details.length).toBeGreaterThanOrEqual(7);
  });

  it('links Privacy Policy and Terms in the footer', () => {
    renderLanding();

    const privacy = screen.getByRole('link', { name: /privacy policy/i });
    const terms = screen.getByRole('link', { name: /terms of service/i });
    expect(privacy).toHaveAttribute('href', '/privacy');
    expect(terms).toHaveAttribute('href', '/terms');
  });

  it('has a log in link pointing at the login route', () => {
    renderLanding();

    const login = screen.getByRole('link', { name: /log in/i });
    expect(login).toHaveAttribute('href', '/login');
  });

  it('renders the final CTA', () => {
    renderLanding();

    const finalCta = screen.getByRole('link', { name: /create your first content pack/i });
    expect(finalCta).toHaveAttribute('href', '/register');
  });
});
