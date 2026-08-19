import {
  adminContext,
  errorResponse,
  json,
  readJson,
  requireAdminEnabled,
} from '../../../../lib/server/admin-http.js';
import { getAdminRuntime } from '../../../../lib/server/admin-runtime.js';

export function GET({ request, url }) {
  const disabled = requireAdminEnabled();
  if (disabled) return disabled;
  try {
    const posts = getAdminRuntime().service.listPosts(adminContext(request), {
      includeDeleted: url.searchParams.get('includeDeleted') === 'true',
    });
    return json({ posts });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST({ request }) {
  const disabled = requireAdminEnabled();
  if (disabled) return disabled;
  try {
    const post = getAdminRuntime().service.createPost(
      adminContext(request),
      await readJson(request),
    );
    return json({ post }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
