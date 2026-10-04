import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'client',
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:4040',
        ws: true,
      },
      '/api': {
        target: 'http://127.0.0.1:4040',
      },
    },
  },
});
