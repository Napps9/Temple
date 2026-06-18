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
    },
  },
  plugins: [],
};
