/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui'],
        sans: ['"Geist"', '"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // Notion-inspired warm grayscale
        paper: '#F7F7F5',
        ink: {
          DEFAULT: '#2F2C28',
          muted: '#787673',
          subtle: '#B5B3AF',
        },
        line: {
          DEFAULT: '#E9E7E1',
          strong: '#D8D5CE',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          sunken: '#F1EFEA',
        },
        // accent — sun-yellow with a leafy alt
        sun: {
          50: '#FFF8DB',
          100: '#FFEFAA',
          200: '#FFE578',
          300: '#FBD24D',
          400: '#E5B82F',
          500: '#B68E1F',
        },
        leaf: {
          200: '#A7E3C2',
          300: '#5BC892',
          400: '#2EBA7F',
          500: '#1F8B5E',
        },
        // status accents (muted, label-like)
        chip: {
          gray: '#EFEDE7',
          brown: '#E9DCCB',
          orange: '#F8D9B3',
          yellow: '#FBE9A6',
          green: '#C7E9D2',
          blue: '#CDDDF1',
          purple: '#DCD0EE',
          pink: '#F2CFDC',
          red: '#F2C5C0',
        },
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(15,15,15,0.04), 0 1px 2px 0 rgba(15,15,15,0.04)',
        drawer: '-12px 0 32px -8px rgba(20,18,15,0.18)',
        focus: '0 0 0 3px rgba(251,210,77,0.45)',
      },
      borderRadius: {
        xs: '3px',
        sm: '4px',
        md: '6px',
        lg: '10px',
      },
    },
  },
  plugins: [],
};
