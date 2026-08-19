import {
  adminContext,
  errorResponse,
  json,
  readJson,
  requireAdminEnabled,
} from '../../../../../lib/server/admin-http.js';
import { getAdminRuntime } from '../../../../../lib/server/admin-runtime.js';

export async function POST({ request, params }) {
  const disabled = requireAdminEnabled();
  if (disabled) return disabled;
  try {
    const post = getAdminRuntime().service.restorePost(
      adminContext(request),
      params.id,
      await readJson(request, { maxBytes: 16_384 }),
    );
    return json({ post });
  } catch (error) {
    return errorResponse(error);
  }
}
