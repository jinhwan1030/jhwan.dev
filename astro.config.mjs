// @ts-check

import mdx from '@astrojs/mdx';
import node from '@astrojs/node';
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://jhwan.dev',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [mdx()],

  vite: {
    plugins: [tailwindcss()],
  },
});
