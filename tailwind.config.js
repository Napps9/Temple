/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#2563EB',
        'primary-dark': '#1D4ED8',
      },
      fontFamily: {
        display: ['SplineSans', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
