import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const adminDirectory = fileURLToPath(new URL('./', import.meta.url));

export default defineConfig({
  root: adminDirectory,
  base: './',
  build: {
    outDir: '../dist-admin',
    emptyOutDir: true,
    sourcemap: false,
    // The full editor is intentionally loaded after authentication. The build
    // validator separately enforces a small initial entry and a ceiling for
    // deferred chunks, so this threshold reflects the accepted route boundary.
    chunkSizeWarningLimit: 550,
  },
  server: {
    host: '127.0.0.1',
    port: 4322,
  },
});
