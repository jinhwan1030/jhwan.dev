import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      pubDate: z.coerce.date(),
      updatedDate: z.preprocess(emptyStringToUndefined, z.coerce.date().optional()),
      heroImage: z.preprocess(emptyStringToUndefined, image().optional()),
      category: z.enum(['홈랩', 'ML/AI', 'Android', '개발', '프로젝트', '일상']).default('개발'),
      draft: z.boolean().default(false),
    }),
});

export const collections = { blog };
