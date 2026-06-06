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
        // Neutral cool grayscale — slate family. Paper is intentionally a
        // perceptible grey (not off-white) so white surface cards "lift" off it.
        paper: '#E4E7EC',
        ink: {
          DEFAULT: '#1F2937',
          muted: '#6B7280',
          subtle: '#8B92A0',
        },
        line: {
          DEFAULT: '#D5D9DF',
          strong: '#B7BDC6',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          sunken: '#D8DBE1',
        },
        // accents kept but desaturated — still recognisable, no longer "loud"
        sun: {
          50: '#FFF7DB',
          100: '#FBE9A6',
          200: '#F5D772',
          300: '#E8C24A',
          400: '#C49B27',
          500: '#8E6E1A',
        },
        leaf: {
          200: '#B8DEC9',
          300: '#79B997',
          400: '#3E9E76',
          500: '#1F7A57',
        },
        // tinted chip backgrounds — cooler, slightly desaturated
        chip: {
          gray: '#E8EAEE',
          brown: '#E2D6C5',
          orange: '#F2D2AC',
          yellow: '#F4E3A0',
          green: '#C7E2D2',
          blue: '#CFDAE9',
          purple: '#D6CCE5',
          pink: '#E9CAD5',
          red: '#ECC5C2',
        },
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(17,24,39,0.04), 0 1px 2px 0 rgba(17,24,39,0.05)',
        drawer: '-12px 0 32px -8px rgba(17,24,39,0.18)',
        focus: '0 0 0 3px rgba(107,114,128,0.35)',
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
