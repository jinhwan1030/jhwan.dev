import {
  ADMIN_CSRF_COOKIE,
  ADMIN_SESSION_COOKIE,
  AuthenticationError,
} from './admin-auth.js';
import { AdminApiError } from './admin-post-service.js';
import { ManagedMediaError } from './media-storage.js';
import { isAdminEnabled } from './admin-runtime.js';

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

export function json(data, { status = 200, headers } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

export function errorResponse(error) {
  if (error instanceof AdminApiError || error instanceof AuthenticationError || error instanceof ManagedMediaError) {
    const status = error.status ?? (error.code === 'invalid_csrf_token' ? 403 : 401);
    return json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status },
    );
  }
  console.error(error instanceof Error ? error.message : 'Unexpected administrator API error');
  return json(
    { error: { code: 'internal_error', message: '요청을 처리하지 못했습니다.' } },
    { status: 500 },
  );
}

export function disabledResponse() {
  return json(
    { error: { code: 'admin_disabled', message: '관리자 기능을 준비 중입니다.' } },
    { status: 503 },
  );
}

export function requireAdminEnabled() {
  return isAdminEnabled() ? null : disabledResponse();
}

export function parseCookies(header) {
  const cookies = Object.create(null);
  for (const source of (header ?? '').split(';')) {
    const part = source.trim();
    const separator = part.indexOf('=');
    if (!part || separator <= 0) continue;
    try {
      cookies[part.slice(0, separator)] = decodeURIComponent(part.slice(separator + 1));
    } catch {
      // Ignore malformed client-controlled cookie values instead of turning an
      // unauthenticated request into a server error.
    }
  }
  return cookies;
}

export function adminContext(request) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  return {
    sessionToken: cookies[ADMIN_SESSION_COOKIE],
    csrfToken: request.headers.get('X-CSRF-Token') ?? cookies[ADMIN_CSRF_COOKIE],
  };
}

export async function readJson(request, { maxBytes = 2_100_000 } = {}) {
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new AdminApiError(415, 'invalid_content_type', 'JSON 요청만 지원합니다.');
  }
  const contentLength = Number(request.headers.get('Content-Length') ?? 0);
  if (contentLength > maxBytes) {
    throw new AdminApiError(413, 'request_too_large', '요청 본문이 너무 큽니다.');
  }
  const source = await request.text();
  if (Buffer.byteLength(source) > maxBytes) {
    throw new AdminApiError(413, 'request_too_large', '요청 본문이 너무 큽니다.');
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new AdminApiError(400, 'invalid_json', '올바른 JSON이 아닙니다.');
  }
}
