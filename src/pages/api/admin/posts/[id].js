import {
  adminContext,
  errorResponse,
  json,
  readJson,
  requireAdminEnabled,
} from '../../../../lib/server/admin-http.js';
import { getAdminRuntime } from '../../../../lib/server/admin-runtime.js';

export function GET({ request, params }) {
  const disabled = requireAdminEnabled();
  if (disabled) return disabled;
  try {
    return json({ post: getAdminRuntime().service.getPost(adminContext(request), params.id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH({ request, params }) {
  const disabled = requireAdminEnabled();
  if (disabled) return disabled;
  try {
    const post = getAdminRuntime().service.updatePost(
      adminContext(request),
      params.id,
      await readJson(request),
    );
    return json({ post });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE({ request, params }) {
  const disabled = requireAdminEnabled();
  if (disabled) return disabled;
  try {
    const post = getAdminRuntime().service.deletePost(
      adminContext(request),
      params.id,
      await readJson(request, { maxBytes: 16_384 }),
    );
    return json({ post });
  } catch (error) {
    return errorResponse(error);
  }
}
