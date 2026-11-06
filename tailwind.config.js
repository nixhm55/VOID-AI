/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      keyframes: {
        'auth-backdrop-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'auth-card-float-in': {
          from: {
            opacity: '0',
            transform: 'translateY(20px) scale(0.97)',
          },
          to: {
            opacity: '1',
            transform: 'translateY(0) scale(1)',
          },
        },
      },
      animation: {
        'auth-backdrop': 'auth-backdrop-in 240ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'auth-card': 'auth-card-float-in 480ms cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
};
