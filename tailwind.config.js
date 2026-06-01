/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0B1220',
          soft: '#1A2230',
        },
        bone: {
          DEFAULT: '#F5F1E8',
          soft: '#EBE4D3',
        },
        brand: {
          DEFAULT: '#C5A572',
          dark: '#8F7748',
        },
      },
      fontFamily: {
        display: ['SplineSans', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
