import { useThemeStore } from '../../stores/themeStore';
import { Sun, Moon, Monitor } from 'lucide-react';

const options: { value: 'light' | 'dark' | 'system'; icon: any; label: string }[] = [
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'dark', icon: Moon, label: 'Dark' },
  { value: 'system', icon: Monitor, label: 'System' },
];

export default function ThemeToggle({ horizontal = false }: { horizontal?: boolean }) {
  const { theme, setTheme } = useThemeStore();

  return (
    <div
      style={{
        display: 'flex',
        gap: '2px',
        padding: '2px',
        borderRadius: '8px',
        background: 'var(--color-paper-2)',
      }}
    >
      {options.map(({ value, icon: Icon, label }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            onClick={() => setTheme(value)}
            title={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: horizontal ? 32 : 28,
              height: horizontal ? 32 : 28,
              borderRadius: '6px',
              border: 'none',
              background: active ? 'var(--color-paper)' : 'transparent',
              color: active ? 'var(--color-accent)' : 'var(--color-muted)',
              boxShadow: active ? 'var(--shadow-sm)' : 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Icon style={{ width: 14, height: 14 }} />
          </button>
        );
      })}
    </div>
  );
}
