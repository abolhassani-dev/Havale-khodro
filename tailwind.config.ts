import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Vazirmatn', 'IRANSansX', 'IRANSans', 'Tahoma', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef7ff',
          100: '#d9ecff',
          200: '#bcdeff',
          300: '#8ec9ff',
          400: '#59aaff',
          500: '#3388fb',
          600: '#1d69f0',
          700: '#1854dc',
          800: '#1a46b2',
          900: '#1b3f8c',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
