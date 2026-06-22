/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Token semantici INFOBI (mappati alle variabili CSS in index.css)
        ground: 'var(--c-ground)',
        surface: 'var(--c-surface)',
        'surface-2': 'var(--c-surface-2)',
        ink: 'var(--c-text)',
        muted: 'var(--c-muted)',
        line: 'var(--c-border)',
        accent: {
          DEFAULT: 'var(--c-accent)',
          soft: 'var(--c-accent-soft)',
          strong: 'var(--c-accent-strong)',
        },
        pos: 'var(--c-up)',
        neg: 'var(--c-down)',
      },
      fontFamily: {
        num: ['var(--font-num)'],
      },
      borderRadius: {
        card: '0.6875rem', // 11px
        panel: '1rem',     // 16px
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        }
      },
      animation: {
        shimmer: 'shimmer 2s infinite linear'
      }
    },
  },
  plugins: [],
}
