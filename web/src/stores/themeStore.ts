import { create } from 'zustand';

type Theme = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: Theme;
  resolved: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolve(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? getSystemTheme() : theme;
}

function apply(resolved: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', resolved);
}

// Read initial preference from localStorage
const stored = (typeof localStorage !== 'undefined' && localStorage.getItem('seed-theme')) as Theme | null;
const initial = stored && ['light', 'dark', 'system'].includes(stored) ? stored : 'system';

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initial,
  resolved: resolve(initial),
  setTheme: (theme) => {
    const resolved = resolve(theme);
    apply(resolved);
    localStorage.setItem('seed-theme', theme);
    set({ theme, resolved });
  },
}));

// Apply on module load (prevents flash)
apply(resolve(initial));

// Listen for system theme changes when on 'system'
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const current = useThemeStore.getState();
    if (current.theme === 'system') {
      const resolved = getSystemTheme();
      apply(resolved);
      useThemeStore.setState({ resolved });
    }
  });
}
