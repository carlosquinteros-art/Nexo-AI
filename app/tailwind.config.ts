import type { Config } from 'tailwindcss';

/**
 * Paleta de Nexo. El acento se resuelve con variables CSS para que cambie
 * según el espacio activo (trabajo, universidad, personal).
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif']
      },
      colors: {
        petrol: { 50:'#ECF5F6',100:'#D2E7E9',200:'#A5CFD3',300:'#71B0B7',400:'#3D8D96',500:'#0D5C63',600:'#0A4B51',700:'#083B40',800:'#062D31',900:'#041F22',950:'#021316' },
        uni:    { 50:'#F0EEFC',100:'#DEDAF8',200:'#BDB4F1',300:'#9A8DE9',400:'#7666DF',500:'#4F46E5',600:'#4038C4',700:'#332C9C',800:'#262176',900:'#1A1750',950:'#0E0C2C' },
        per:    { 50:'#EAF8F2',100:'#CFEFE1',200:'#A1DFC4',300:'#6ECBA3',400:'#3AB484',500:'#0F9D75',600:'#0C7F5F',700:'#096148',800:'#064534',900:'#042A20',950:'#021711' },
        warnc:  { 50:'#FEF7EA',100:'#FCEBCB',200:'#F8D79A',400:'#E8A33C',500:'#D97706',600:'#B45309',700:'#8A3F07' },
        critc:  { 50:'#FEEEEE',100:'#FBD9D9',200:'#F5B4B4',400:'#EC5B5B',500:'#DC2626',600:'#B91C1C',700:'#8F1616' },
        okc:    { 50:'#EBF8F0',100:'#D0EFDD',200:'#A3DFBC',400:'#3EB86E',500:'#16A34A',600:'#12833B',700:'#0D6630' },
        ink:    { 50:'#F7F8FA',100:'#EFF1F5',200:'#E2E6EC',300:'#CBD2DC',400:'#98A3B3',500:'#6B7688',600:'#4C5566',700:'#353D4B',800:'#232A36',850:'#1A2029',900:'#131820',950:'#0B0F15' }
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px 0 rgb(16 24 40 / 0.06)',
        pop: '0 12px 32px -8px rgb(16 24 40 / 0.22), 0 4px 12px -4px rgb(16 24 40 / 0.12)'
      },
      borderRadius: { xl2: '1.125rem', '2xl2': '1.375rem' }
    }
  },
  plugins: []
} satisfies Config;
