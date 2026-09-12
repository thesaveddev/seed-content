import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Zap, ArrowRight, ArrowLeft, Check } from 'lucide-react';
import toast from 'react-hot-toast';

const roles = ['Creator', 'Founder', 'Marketer', 'Agency', 'Coach', 'Consultant', 'Business', 'Other'];

const platforms = [
  { id: 'linkedin', name: 'LinkedIn', icon: '💼' },
  { id: 'x', name: 'X', icon: '𝕏' },
  { id: 'instagram', name: 'Instagram', icon: '📸' },
  { id: 'tiktok', name: 'TikTok', icon: '🎵' },
  { id: 'youtube', name: 'YouTube', icon: '▶️' },
  { id: 'threads', name: 'Threads', icon: '🧵' },
  { id: 'newsletter', name: 'Newsletter', icon: '📧' },
  { id: 'blog', name: 'Blog', icon: '✍️' },
];

const tones = [
  'Professional', 'Conversational', 'Educational', 'Bold',
  'Funny', 'Storytelling', 'Inspirational', 'Technical', 'Friendly',
];

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState({
    role: '',
    platforms: [] as string[],
    audience: '',
    topics: '',
    tones: [] as string[],
    brandDescription: '',
  });
  const { updateOnboarding, setUser, user } = useAuthStore();
  const navigate = useNavigate();

  const togglePlatform = (id: string) => {
    setData((d) => ({
      ...d,
      platforms: d.platforms.includes(id)
        ? d.platforms.filter((p) => p !== id)
        : [...d.platforms, id],
    }));
  };

  const toggleTone = (tone: string) => {
    setData((d) => ({
      ...d,
      tones: d.tones.includes(tone)
        ? d.tones.filter((t) => t !== tone)
        : [...d.tones, tone],
    }));
  };

  const handleFinish = async () => {
    try {
      await updateOnboarding(data);
      // Update local auth state so ProtectedRoute stops redirecting to onboarding
      if (user) {
        setUser({ ...user, onboardingCompleted: true, onboardingData: data });
      }
      navigate('/dashboard', { replace: true });
      toast.success('Welcome! Your workspace is ready.');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const steps = [
    {
      title: 'What do you do?',
      subtitle: 'Select the option that best describes you.',
      content: (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {roles.map((role) => (
            <button
              key={role}
              onClick={() => setData((d) => ({ ...d, role }))}
              className={`rounded-xl border-2 p-4 text-center text-sm font-medium transition-all ${
                data.role === role
                  ? 'border-brand-600 bg-paper-2 text-brand-700'
                  : 'border-rule hover:border-rule'
              }`}
            >
              {role}
            </button>
          ))}
        </div>
      ),
    },
    {
      title: 'What platforms do you use?',
      subtitle: 'Select all that apply.',
      content: (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {platforms.map((p) => (
            <button
              key={p.id}
              onClick={() => togglePlatform(p.id)}
              className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-sm font-medium transition-all ${
                data.platforms.includes(p.id)
                  ? 'border-brand-600 bg-paper-2 text-brand-700'
                  : 'border-rule hover:border-rule'
              }`}
            >
              <span className="text-2xl">{p.icon}</span>
              {data.platforms.includes(p.id) && <Check className="h-4 w-4 text-accent" />}
              {p.name}
            </button>
          ))}
        </div>
      ),
    },
    {
      title: 'Who is your audience?',
      subtitle: 'Describe who you create content for.',
      content: (
        <textarea
          value={data.audience}
          onChange={(e) => setData((d) => ({ ...d, audience: e.target.value }))}
          className="input min-h-[120px]"
          placeholder="e.g., SaaS founders, early-stage startup teams, developers interested in entrepreneurship..."
        />
      ),
    },
    {
      title: 'What topics do you talk about?',
      subtitle: 'What subjects do you create content around?',
      content: (
        <textarea
          value={data.topics}
          onChange={(e) => setData((d) => ({ ...d, topics: e.target.value }))}
          className="input min-h-[120px]"
          placeholder="e.g., Building SaaS products, startup lessons, product development, remote work..."
        />
      ),
    },
    {
      title: 'What tone should your content have?',
      subtitle: 'Select all that apply.',
      content: (
        <div className="flex flex-wrap gap-2">
          {tones.map((tone) => (
            <button
              key={tone}
              onClick={() => toggleTone(tone)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                data.tones.includes(tone)
                  ? 'bg-accent text-white'
                  : 'bg-gray-100 text-ink-2 hover:bg-gray-200'
              }`}
            >
              {data.tones.includes(tone) && '✓ '}{tone}
            </button>
          ))}
        </div>
      ),
    },
    {
      title: 'Describe your brand voice',
      subtitle: 'How do you normally communicate?',
      content: (
        <textarea
          value={data.brandDescription}
          onChange={(e) => setData((d) => ({ ...d, brandDescription: e.target.value }))}
          className="input min-h-[120px]"
          placeholder="e.g., Direct and conversational. I use short sentences. I share personal experiences. I'm technical but keep things accessible."
        />
      ),
    },
  ];

  const currentStep = steps[step];
  const canNext = step === 0 ? !!data.role : step === 1 ? data.platforms.length > 0 : true;

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <div className="border-b border-rule">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-bold text-ink">Seed</span>
          </div>
          <span className="text-sm text-muted">
            Step {step + 1} of {steps.length}
          </span>
        </div>
      </div>

      <div className="h-1 bg-gray-100">
        <div
          className="h-1 bg-accent transition-all duration-300"
          style={{ width: `${((step + 1) / steps.length) * 100}%` }}
        />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg animate-fade-in">
          <h1 className="text-2xl font-bold text-ink">{currentStep.title}</h1>
          <p className="mt-2 text-sm text-ink-2">{currentStep.subtitle}</p>
          <div className="mt-8">{currentStep.content}</div>
        </div>
      </div>

      <div className="border-t border-rule px-4 py-4">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <button
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 0}
            className="btn-ghost"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          {step === steps.length - 1 ? (
            <button onClick={handleFinish} className="btn-primary">
              Get started
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canNext}
              className="btn-primary"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
