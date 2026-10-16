/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // System UI font plus a bundled Devanagari-capable fallback so
        // Hindi/Marathi names render offline (00-conventions §1).
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          '"Noto Sans Devanagari"',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
