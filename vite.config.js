import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { rollupOptions: { input: { main: 'index.html', overlay: 'overlay.html' } } },
  server: {
    watch: {
      ignored: ['**/release/**'],
    },
  },
});
