/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        accent: '#4f6d8e',
        success: '#3a8a7a',
        warning: '#c4873a',
        danger: '#b84444',
        system: '#a85040',
        'surface-bg': '#f5f4f2',
        'surface-card': '#fafaf8',
        'surface-border': '#e2e0dc',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
