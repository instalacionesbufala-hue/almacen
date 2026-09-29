import type { Config } from 'tailwindcss';
import { fileURLToPath } from 'node:url';

const aqui = (p: string) => fileURLToPath(new URL(p, import.meta.url)).split('\\').join('/');

// Tokens del diseño Stitch (diseno/stitch/*.html)
export default {
  content: [aqui('./index.html'), aqui('./src') + '/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#f8f9ff', surface: '#f8f9ff', 'surface-bright': '#f8f9ff', 'surface-dim': '#cbdbf5',
        'surface-container-lowest': '#ffffff', 'surface-container-low': '#eff4ff', 'surface-container': '#e5eeff',
        'surface-container-high': '#dce9ff', 'surface-container-highest': '#d3e4fe', 'surface-variant': '#d3e4fe',
        'on-surface': '#0b1c30', 'on-surface-variant': '#434655', 'on-background': '#0b1c30',
        'inverse-surface': '#213145', 'inverse-on-surface': '#eaf1ff', 'inverse-primary': '#b7c4ff',
        outline: '#747686', 'outline-variant': '#c4c5d7',
        primary: '#0037b0', 'on-primary': '#ffffff', 'primary-container': '#1d4ed8', 'on-primary-container': '#cad3ff',
        'primary-fixed': '#dce1ff', 'primary-fixed-dim': '#b7c4ff', 'surface-tint': '#2151da',
        secondary: '#565e74', 'on-secondary': '#ffffff', 'secondary-container': '#dae2fd', 'on-secondary-container': '#5c647a',
        'secondary-fixed': '#dae2fd', 'secondary-fixed-dim': '#bec6e0',
        tertiary: '#004f35', 'on-tertiary': '#ffffff', 'tertiary-container': '#006a48', 'on-tertiary-container': '#60eeb1',
        'tertiary-fixed': '#6ffbbe', 'tertiary-fixed-dim': '#4edea3', 'on-tertiary-fixed': '#002113',
        error: '#ba1a1a', 'on-error': '#ffffff', 'error-container': '#ffdad6', 'on-error-container': '#93000a',
      },
      borderRadius: { DEFAULT: '0.25rem', lg: '0.5rem', xl: '0.75rem', '2xl': '1rem', '3xl': '1.5rem', full: '9999px' },
      spacing: {
        'space-xs': '0.25rem', 'space-sm': '0.5rem', 'space-md': '1rem', 'space-lg': '1.5rem', 'space-xl': '2.5rem',
        gutter: '1.5rem', 'gutter-mobile': '0.75rem', margin: '2rem', 'margin-mobile': '1rem',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'headline-xl': ['36px', { lineHeight: '44px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-xl-mobile': ['28px', { lineHeight: '34px', letterSpacing: '-0.01em', fontWeight: '700' }],
        'headline-lg': ['28px', { lineHeight: '36px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-lg-mobile': ['22px', { lineHeight: '28px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'headline-md': ['20px', { lineHeight: '28px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'headline-sm': ['16px', { lineHeight: '24px', fontWeight: '600' }],
        'body-lg': ['16px', { lineHeight: '24px' }],
        'body-md': ['14px', { lineHeight: '20px' }],
        'body-sm': ['12px', { lineHeight: '16px' }],
        'label-lg': ['14px', { lineHeight: '20px', letterSpacing: '0.02em', fontWeight: '600' }],
        'label-md': ['12px', { lineHeight: '16px', letterSpacing: '0.04em', fontWeight: '500' }],
        'label-sm': ['10px', { lineHeight: '14px', letterSpacing: '0.06em', fontWeight: '500' }],
      },
    },
  },
  plugins: [],
} satisfies Config;
