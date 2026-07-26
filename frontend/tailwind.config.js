/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        carmine: { DEFAULT: '#B71C1C', light: '#E53935', dark: '#7F0000' },
        leaf: { DEFAULT: '#2E7D32', light: '#4CAF50', dark: '#1B5E20' },
        surface: '#0a0a0a',
        muted: '#6b7280',
        border: '#1f2937',
      },
      fontFamily: {
        display: ['Pacifico', 'cursive'],
        numeric: ['"Bagel Fat One"', 'cursive'],
        mono: ['"JetBrains Mono"', 'monospace'],
        body: ['system-ui', '-apple-system', 'sans-serif'],
      },
      spacing: {
        1: '0.25rem',
        2: '0.5rem',
        3: '0.75rem',
        4: '1rem',
        6: '1.5rem',
        8: '2rem',
        12: '3rem',
        16: '4rem',
      },
    },
  },
};
