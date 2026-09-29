import { fileURLToPath } from 'node:url';

// Rutas absolutas: funciona aunque el servidor se arranque desde otra carpeta
export default {
  plugins: {
    tailwindcss: { config: fileURLToPath(new URL('./tailwind.config.ts', import.meta.url)) },
    autoprefixer: {},
  },
};
