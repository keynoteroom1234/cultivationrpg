/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // You can extend Tailwind's color palette here if needed
      },
      fontFamily: {
        inter: ['Inter', 'sans-serif'],
        notoSerifSC: ['"Noto Serif SC"', 'serif'],
      }
    },
  },
  plugins: [],
}