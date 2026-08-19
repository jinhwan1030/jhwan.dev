import {
  adminContext,
  errorResponse,
  json,
  requireAdminEnabled,
} from '../../../../../lib/server/admin-http.js';
import { getAdminRuntime } from '../../../../../lib/server/admin-runtime.js';

export function GET({ request, params }) {
  const disabled = requireAdminEnabled();
  if (disabled) return disabled;
  try {
    const revisions = getAdminRuntime().service.listRevisions(adminContext(request), params.id);
    return json({ revisions });
  } catch (error) {
    return errorResponse(error);
  }
}
