/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: 'oklch(97% 0.010 270)',
          2: 'oklch(94% 0.012 270)',
          3: 'oklch(91% 0.014 270)',
          ink: 'oklch(97% 0.010 270)',
        },
        ink: {
          DEFAULT: 'oklch(18% 0.014 270)',
          2: 'oklch(36% 0.012 270)',
        },
        rule: {
          DEFAULT: 'oklch(84% 0.012 270)',
          2: 'oklch(88% 0.010 270)',
        },
        muted: 'oklch(50% 0.010 270)',
        accent: {
          DEFAULT: 'oklch(52% 0.18 270)',
          ink: 'oklch(97% 0.010 270)',
          light: 'oklch(93% 0.04 270)',
          hover: 'oklch(47% 0.20 270)',
        },
        focus: 'oklch(50% 0.22 270)',
        success: 'oklch(62% 0.14 155)',
        error: 'oklch(55% 0.18 25)',
        warning: 'oklch(75% 0.14 75)',
        info: 'oklch(60% 0.14 270)',
      },
      fontFamily: {
        display: ['"Newsreader"', 'ui-serif', 'Georgia', '"Cambria"', 'serif'],
        body: ['"Source Serif 4"', 'ui-serif', 'Georgia', '"Cambria"', 'serif'],
        mono: ['"Geist Mono"', 'ui-monospace', '"Cascadia Mono"', 'monospace'],
        ui: ['"Source Serif 4"', 'ui-serif', 'Georgia', 'serif'],
      },
      fontSize: {
        'display': 'clamp(2.75rem, 5vw + 1rem, 5.25rem)',
        'display-s': 'clamp(2rem, 3vw + 0.75rem, 3.5rem)',
      },
      spacing: {
        '3xs': '0.125rem',
        '2xs': '0.25rem',
      },
      borderRadius: {
        'sm': '4px',
        'md': '6px',
        'lg': '8px',
        'xl': '12px',
      },
      boxShadow: {
        'soft': '0 1px 2px oklch(18% 0.014 270 / 0.06)',
        'card': '0 2px 8px oklch(18% 0.014 270 / 0.08)',
        'elevated': '0 4px 16px oklch(18% 0.014 270 / 0.10)',
      },
      transitionTimingFunction: {
        'out': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'in': 'cubic-bezier(0.7, 0, 0.84, 0)',
        'in-out': 'cubic-bezier(0.65, 0, 0.35, 1)',
      },
      transitionDuration: {
        'short': '150ms',
        'medium': '250ms',
        'long': '400ms',
      },
      maxWidth: {
        'measure': '65ch',
      },
    },
  },
  plugins: [],
};
