import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { rollupOptions: { input: { main: 'index.html', overlay: 'overlay.html' } } },
  server: {
    watch: {
      ignored: ['**/release/**'],
    },
  },
});
