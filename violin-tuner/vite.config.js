import { defineConfig } from 'vite';

export default defineConfig({
  worker: { format: 'es' },
  base: process.env.VITE_BASE_PATH || '/',
});
