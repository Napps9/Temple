/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Runtime-driven so `bg-primary`, `text-primary/30` etc.
        // follow the gym's saved primary_color. Defaults are set in
        // src/global.css and overridden at the root of the React tree
        // by ThemedShell via NativeWind's `vars()` helper. The
        // `<alpha-value>` placeholder lets the `/NN` opacity suffix
        // keep working (e.g. `bg-primary/15`).
        primary: 'rgb(var(--color-primary) / <alpha-value>)',
        'primary-dark': 'rgb(var(--color-primary-dark) / <alpha-value>)',
        // Brand "Text" colour — links and CTA copy. Brand "Secondary" —
        // accent chips / tints. Both runtime-driven like primary.
        link: 'rgb(var(--color-link) / <alpha-value>)',
        secondary: 'rgb(var(--color-secondary) / <alpha-value>)',
      },
      fontFamily: {
        display: ['SplineSans', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        // Selective elevation so a few raised surfaces read as layered
        // against the flat slate ground — depth comes from contrast, not
        // from shadowing everything. card = content containers + primary
        // buttons; pop = hero / brand accents; pill = small active toggles.
        card: '0 1px 2px rgb(15 23 42 / 0.04), 0 4px 14px rgb(15 23 42 / 0.08)',
        pop: '0 6px 20px rgb(15 23 42 / 0.16)',
        pill: '0 1px 3px rgb(15 23 42 / 0.12)',
      },
    },
  },
  plugins: [],
};
