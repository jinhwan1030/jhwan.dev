import {
  clearAdminCsrfCookie,
  clearAdminSessionCookie,
  serializeAdminCsrfCookie,
  serializeAdminSessionCookie,
} from '../../../lib/server/admin-auth.js';
import {
  adminContext,
  errorResponse,
  json,
  readJson,
  requireAdminEnabled,
} from '../../../lib/server/admin-http.js';
import { getAdminRuntime } from '../../../lib/server/admin-runtime.js';

export function GET({ request }) {
  const disabled = requireAdminEnabled();
  if (disabled) return disabled;
  try {
    const session = getAdminRuntime().service.getSession(adminContext(request));
    return json({ session });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST({ request }) {
  const disabled = requireAdminEnabled();
  if (disabled) return disabled;
  try {
    const input = await readJson(request, { maxBytes: 16_384 });
    if (typeof input?.ticket !== 'string') {
      return json(
        { error: { code: 'invalid_login_ticket', message: '로그인 티켓이 없습니다.' } },
        { status: 400 },
      );
    }
    const { sessionToken, csrfToken, session } = getAdminRuntime().auth.exchangeLoginTicket(input.ticket);
    const response = json({ session });
    response.headers.append('Set-Cookie', serializeAdminSessionCookie(sessionToken));
    response.headers.append('Set-Cookie', serializeAdminCsrfCookie(csrfToken));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

export function DELETE({ request }) {
  const disabled = requireAdminEnabled();
  if (disabled) return disabled;
  try {
    const runtime = getAdminRuntime();
    const context = adminContext(request);
    const session = runtime.auth.verifySession(context.sessionToken);
    runtime.auth.verifyCsrf(session, context.csrfToken);
    runtime.auth.revoke(context.sessionToken);
    const response = json({ ok: true });
    response.headers.append('Set-Cookie', clearAdminSessionCookie());
    response.headers.append('Set-Cookie', clearAdminCsrfCookie());
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
