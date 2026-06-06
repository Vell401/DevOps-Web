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
        // Dark canvas. paper = the user's #696969 (DimGray). Cards lift one
        // step lighter, recessed states (inputs, hover) one step darker.
        paper: '#696969',
        ink: {
          DEFAULT: '#F2F2F2',
          muted: '#CFCFCF',
          subtle: '#A1A1A1',
        },
        line: {
          DEFAULT: '#8A8A8A',
          strong: '#A1A1A1',
        },
        surface: {
          DEFAULT: '#7C7C7C',
          sunken: '#5A5A5A',
        },
        // Accents — same as before, they pop nicely on dark grey.
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
        // Chip backgrounds stay pastel so they read as "islands" of colour
        // on a dark grey card. Per-chip text colours in lib/meta.ts are dark
        // hex values, which sit well on the pastel pads.
        chip: {
          gray: '#9CA3AF',
          brown: '#D6C5A8',
          orange: '#EFC58E',
          yellow: '#F2DC86',
          green: '#B7D8C0',
          blue: '#BCC9D9',
          purple: '#C9BFD9',
          pink: '#DEBDC8',
          red: '#E1B6B2',
        },
      },
      boxShadow: {
        // Shadows are subtle on dark — borders do most of the lifting. Keep
        // a tiny one so cards still feel layered.
        card: '0 1px 0 0 rgba(0,0,0,0.18), 0 1px 2px 0 rgba(0,0,0,0.18)',
        drawer: '-12px 0 32px -8px rgba(0,0,0,0.45)',
        focus: '0 0 0 3px rgba(232,194,74,0.45)',
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
