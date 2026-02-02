import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          0: 'var(--bg0)',
          1: 'var(--bg1)',
          2: 'var(--bg2)',
          3: 'var(--bg3)',
        },
        fg: {
          0: 'var(--fg0)',
          1: 'var(--fg1)',
          2: 'var(--fg2)',
          3: 'var(--fg3)',
        },
        bd: {
          0: 'var(--bd0)',
          1: 'var(--bd1)',
        },
        status: {
          success: 'var(--success)',
          warning: 'var(--warning)',
          danger: 'var(--danger)',
          info: 'var(--info)',
          progress: 'var(--progress)',
          idle: 'var(--idle)',
        },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
      },
      fontSize: {
        'page-title': ['20px', { lineHeight: '1.2', fontWeight: '600' }],
        'section-title': ['14px', { lineHeight: '1.3', fontWeight: '600' }],
        body: ['13px', { lineHeight: '1.4', fontWeight: '450' }],
        caption: ['12px', { lineHeight: '1.35', fontWeight: '450' }],
        'mono-sm': ['12px', { lineHeight: '1.4', fontWeight: '500' }],
        'mono-md': ['13px', { lineHeight: '1.4', fontWeight: '500' }],
      },
      borderRadius: {
        card: '2px',
        input: '2px',
        pill: '999px',
      },
      spacing: {
        unit: '8px',
        panel: '12px',
        card: '12px',
        page: '16px',
      },
    },
  },
  plugins: [],
}

export default config
