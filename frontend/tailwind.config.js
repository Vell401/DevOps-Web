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
        // Discord-derived multi-tier dark grey palette.
        // The four surface tiers create depth without visible borders:
        //   surface-deep  (#1E1F22) — recessed: inputs, kbd, deepest panel
        //   surface-sunken(#2B2D31) — sidebar / "DM list" tier
        //   paper         (#313338) — main canvas
        //   surface       (#383A40) — raised cards on canvas
        //   surface-hover (#404249) — hover state
        paper: '#313338',
        ink: {
          DEFAULT: '#F2F3F5',
          muted: '#B5BAC1',
          subtle: '#949BA4',
        },
        line: {
          DEFAULT: '#3F4147',
          strong: '#4E5058',
        },
        surface: {
          DEFAULT: '#383A40',
          sunken: '#2B2D31',
          deep: '#1E1F22',
          hover: '#404249',
        },
        // Discord blurple — the one and only primary CTA colour.
        blurple: {
          DEFAULT: '#5865F2',
          hover: '#4752C4',
          soft: 'rgba(88,101,242,0.18)',
        },
        // Discord status colours — used for STATUS_META + priority + dots.
        status: {
          online: '#23A55A',
          idle: '#F0B232',
          dnd: '#F23F43',
          offline: '#80848E',
        },
        // Legacy accent aliases — kept so any leftover `sun-300`/`leaf-300`
        // references still resolve to the new equivalent palette.
        sun: {
          200: '#FBE89A',
          300: '#F0B232',
          400: '#E0A015',
          500: '#A66E0E',
        },
        leaf: {
          200: '#A5DEB6',
          300: '#3BA55D',
          400: '#23A55A',
          500: '#1A7C44',
        },
        // Chip backgrounds — dark tinted pads. Combined with bright text in
        // meta.ts they read as Discord-style role tags.
        chip: {
          gray: '#404249',
          brown: '#4A3A2A',
          orange: '#5A3D1F',
          yellow: '#574A1A',
          green: '#1F4D2E',
          blue: '#2C3760',
          purple: '#3D2E5C',
          pink: '#5C2C40',
          red: '#5C2424',
        },
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(0,0,0,0.2), 0 2px 4px 0 rgba(0,0,0,0.15)',
        drawer: '-12px 0 32px -8px rgba(0,0,0,0.55)',
        focus: '0 0 0 3px rgba(88,101,242,0.45)',
        glow: '0 0 0 1px rgba(88,101,242,0.35), 0 4px 12px -2px rgba(88,101,242,0.25)',
      },
      borderRadius: {
        xs: '4px',
        sm: '6px',
        md: '8px',
        lg: '12px',
      },
    },
  },
  plugins: [],
};
