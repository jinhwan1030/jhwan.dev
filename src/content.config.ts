import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const CATEGORIES = {
  '홈랩': '🖥️',
  'ML/AI': '🤖',
  'Android': '📱',
  '개발': '💻',
  '프로젝트': '🗂️',
  '일상': '✍️',
} as const;

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      heroImage: z.optional(image()),
      category: z.enum(['홈랩', 'ML/AI', 'Android', '개발', '프로젝트', '일상']).default('개발'),
    }),
});

export const collections = { blog };