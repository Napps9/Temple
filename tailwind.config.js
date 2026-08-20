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

        // ------------------------------------------------------------------
        // The neutral ramp. Cool, monochrome, and named for the job rather
        // than the hue, so a surface says what it is instead of which grey
        // it happens to be this month. `-dk` is the dark-scheme partner:
        //
        //     className="bg-surface dark:bg-surface-dk"
        //
        // Paired at the call site rather than driven by a CSS variable
        // because that is how every existing screen already switches, and
        // one mechanism beats two. The slate/gray utilities are still here
        // and still work — this ramp only applies where it is used.
        // ------------------------------------------------------------------
        ground: '#F7F7F8', // behind the cards
        'ground-dk': '#0A0B0D',
        surface: '#FFFFFF', // every card
        'surface-dk': '#131519',
        raised: '#F1F1F4', // selected pills, insets, bar tracks
        'raised-dk': '#1B1E23',
        sunken: '#E9E9EE', // the unfilled half of a progress bar
        'sunken-dk': '#23272D',
        line: '#E9E9EE', // every border
        'line-dk': '#26282D',
        'line-strong': '#DCDCE3', // borders that have to be found by eye
        'line-strong-dk': '#34373D',
        ink: '#14161A', // primary text, dark buttons, the AI mark
        'ink-dk': '#F4F5F6',
        'ink-2': '#5B606A', // body copy, secondary text
        'ink-2-dk': '#9AA0A9',
        'ink-3': '#8B909A', // labels, meta, placeholder
        'ink-3-dk': '#6C727B',
      },
      borderRadius: {
        // Two radii, chosen by what the thing is: a card, or a control
        // that is not a pill.
        card: '16px',
        ctl: '12px',
      },
      fontFamily: {
        sans: ['Geist_400Regular', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        // Selective elevation so a few raised surfaces read as layered
        // against the flat slate ground — depth comes from contrast, not
        // from shadowing everything. card = content containers + primary
        // buttons; pop = hero / brand accents; pill = small active toggles.
        //
        // These three are on the way out: the new ramp gets its depth from
        // a hairline and a tone step, and only things that genuinely float
        // (a sheet, a raised selected row) keep a shadow. `soft` and
        // `float` below are what replaces them. Nothing has been removed
        // yet because ~90 screens still name the old three.
        card: '0 1px 2px rgb(15 23 42 / 0.04), 0 4px 14px rgb(15 23 42 / 0.08)',
        pop: '0 6px 20px rgb(15 23 42 / 0.16)',
        pill: '0 1px 3px rgb(15 23 42 / 0.12)',
        soft: '0 1px 2px rgb(16 18 22 / 0.05), 0 8px 24px rgb(16 18 22 / 0.06)',
        float: '0 2px 6px rgb(16 18 22 / 0.07), 0 16px 40px rgb(16 18 22 / 0.12)',
      },
    },
  },
  // Every font-weight utility carries its own family, because React
  // Native does not synthesise weights for a custom font: `fontFamily:
  // 'Geist'` with `fontWeight: '700'` renders regular on Android and
  // fake-bolds on iOS. @expo-google-fonts ships one file per weight, so
  // the weight utility has to pick the file.
  //
  // Order matters and is load-bearing: these are emitted in object order
  // after Tailwind's own, and two utilities of equal specificity are
  // resolved by source order. Lightest first means `font-bold` still wins
  // over the `font-normal` that components/Text.tsx prepends.
  //
  // Weights not listed here (thin, light, extrabold, black) are not
  // loaded and would fall back to the platform font mid-sentence, so the
  // app deliberately has four.
  plugins: [
    ({ addUtilities }) => {
      addUtilities({
        '.font-normal': { fontFamily: 'Geist_400Regular', fontWeight: '400' },
        '.font-medium': { fontFamily: 'Geist_500Medium', fontWeight: '500' },
        '.font-semibold': { fontFamily: 'Geist_600SemiBold', fontWeight: '600' },
        '.font-bold': { fontFamily: 'Geist_700Bold', fontWeight: '700' },
      });
    },
  ],
};
