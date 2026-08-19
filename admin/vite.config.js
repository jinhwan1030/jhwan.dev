import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const adminDirectory = fileURLToPath(new URL('./', import.meta.url));

export default defineConfig({
  root: adminDirectory,
  base: './',
  build: {
    outDir: '../dist-admin',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    port: 4322,
  },
});
