// @ts-check

import mdx from '@astrojs/mdx';
import node from '@astrojs/node';
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import { MAX_REQUEST_BODY_BYTES } from './src/lib/server/security-headers.js';

// https://astro.build/config
export default defineConfig({
  site: 'https://jhwan.dev',
  output: 'server',
  adapter: node({ mode: 'standalone', bodySizeLimit: MAX_REQUEST_BODY_BYTES }),
  integrations: [mdx()],

  vite: {
    plugins: [tailwindcss()],
  },
});
