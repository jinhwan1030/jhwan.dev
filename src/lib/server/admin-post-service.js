import { z } from 'zod';
import { AuthenticationError } from './admin-auth.js';
import {
  PostNotFoundError,
  PostSlugConflictError,
  PostVersionConflictError,
} from './post-repository.js';

export const POST_CATEGORIES = ['홈랩', 'ML/AI', 'Android', '개발', '프로젝트', '일상'];

export class AdminApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .transform((value) => value.normalize('NFC'))
  .refine((value) => !value.startsWith('/') && !value.endsWith('/') && !value.includes('//'), {
    message: 'slug must not contain empty path segments',
  })
  .refine((value) => /^[\p{L}\p{N}][\p{L}\p{N}_\-/]*$/u.test(value), {
    message: 'slug contains unsupported characters',
  })
  .refine(
    (value) => value.split('/').map((segment) => encodeURIComponent(segment)).join('/').length <= 240,
    {
    message: 'slug is too long when URL encoded',
    },
  );

const optionalDateSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'invalid date' })
  .transform((value) => new Date(value).toISOString())
  .nullable();

const mutablePostFields = {
  slug: slugSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(500),
  bodyMarkdown: z.string().max(2_000_000),
  category: z.enum(POST_CATEGORIES),
  status: z.enum(['draft', 'published']),
  heroImagePath: z
    .string()
    .trim()
    .max(2_048)
    .refine(
      (value) => /^\/uploads\/[A-Za-z0-9][A-Za-z0-9/_-]*\.[A-Za-z0-9]+$/.test(value),
      { message: 'heroImagePath must point to a managed upload' },
    )
    .nullable(),
  publishedAt: optionalDateSchema,
};

const createPostSchema = z.strictObject({
  ...mutablePostFields,
  category: mutablePostFields.category.default('개발'),
  status: mutablePostFields.status.default('draft'),
  heroImagePath: mutablePostFields.heroImagePath.optional().default(null),
  publishedAt: mutablePostFields.publishedAt.optional().default(null),
});

const updatePostSchema = z
  .strictObject({
    expectedVersion: z.number().int().positive(),
    ...Object.fromEntries(
      Object.entries(mutablePostFields).map(([field, schema]) => [field, schema.optional()]),
    ),
  })
  .refine((value) => Object.keys(value).some((field) => field !== 'expectedVersion'), {
    message: 'at least one post field must be updated',
  });

const versionSchema = z.strictObject({ expectedVersion: z.number().int().positive() });
const idSchema = z.string().min(1).max(128);

function mapError(error) {
  if (error instanceof AdminApiError) return error;
  if (error instanceof AuthenticationError) {
    const status = error.code === 'invalid_csrf_token' ? 403 : 401;
    return new AdminApiError(status, error.code, error.message);
  }
  if (error instanceof z.ZodError) {
    return new AdminApiError(400, 'invalid_request', 'Request validation failed', error.issues);
  }
  if (error instanceof PostNotFoundError) {
    return new AdminApiError(404, 'post_not_found', error.message);
  }
  if (error instanceof PostVersionConflictError) {
    return new AdminApiError(409, 'version_conflict', error.message, {
      actualVersion: error.actualVersion,
    });
  }
  if (error instanceof PostSlugConflictError) {
    return new AdminApiError(409, 'slug_conflict', error.message, { slug: error.slug });
  }
  return error;
}

export function createAdminPostService({ auth, repository }) {
  function run(operation) {
    try {
      return operation();
    } catch (error) {
      throw mapError(error);
    }
  }

  function authorize(context, { write = false } = {}) {
    const session = auth.verifySession(context?.sessionToken);
    if (write) auth.verifyCsrf(session, context?.csrfToken);
    return session;
  }

  return {
    getSession(context) {
      return run(() => {
        const session = authorize(context);
        return {
          githubUserId: session.githubUserId,
          githubLogin: session.githubLogin,
          expiresAt: session.expiresAt,
        };
      });
    },

    listPosts(context, { includeDeleted = false } = {}) {
      return run(() => {
        authorize(context);
        return repository.list({ includeDeleted: Boolean(includeDeleted) });
      });
    },

    getPost(context, id) {
      return run(() => {
        authorize(context);
        const post = repository.findById(idSchema.parse(id));
        if (!post) throw new PostNotFoundError(id);
        return post;
      });
    },

    listRevisions(context, id) {
      return run(() => {
        authorize(context);
        const postId = idSchema.parse(id);
        if (!repository.findById(postId)) throw new PostNotFoundError(postId);
        return repository.listRevisions(postId);
      });
    },

    createPost(context, input) {
      return run(() => {
        authorize(context, { write: true });
        return repository.create(createPostSchema.parse(input));
      });
    },

    updatePost(context, id, input) {
      return run(() => {
        authorize(context, { write: true });
        const postId = idSchema.parse(id);
        const { expectedVersion, ...parsedPatch } = updatePostSchema.parse(input);
        const patch = Object.fromEntries(
          Object.entries(parsedPatch).filter(([, value]) => value !== undefined),
        );
        return repository.update(postId, expectedVersion, patch);
      });
    },

    deletePost(context, id, input) {
      return run(() => {
        authorize(context, { write: true });
        const postId = idSchema.parse(id);
        const { expectedVersion } = versionSchema.parse(input);
        return repository.softDelete(postId, expectedVersion);
      });
    },

    restorePost(context, id, input) {
      return run(() => {
        authorize(context, { write: true });
        const postId = idSchema.parse(id);
        const { expectedVersion } = versionSchema.parse(input);
        return repository.restore(postId, expectedVersion);
      });
    },
  };
}
