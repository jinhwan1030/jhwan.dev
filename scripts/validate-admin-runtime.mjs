import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { signAdminLoginTicket } from '../src/lib/server/admin-auth.js';
import { startRuntimeServer } from './lib/runtime-server.mjs';

const secret = 'runtime-http-ticket-secret-at-least-32-bytes';
const githubUserId = '12345678';
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-runtime-admin-'));
const server = await startRuntimeServer({
  databasePath: path.join(temporaryDirectory, 'content.db'),
  environment: {
    JHWAN_ADMIN_ENABLED: 'true',
    ADMIN_GITHUB_USER_ID: githubUserId,
    ADMIN_LOGIN_TICKET_SECRET: secret,
  },
});

function cookieValue(setCookies, name) {
  const source = setCookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!source) throw new Error(`Missing response cookie: ${name}`);
  return source.split(';', 1)[0].slice(name.length + 1);
}

async function jsonRequest(pathname, { method = 'GET', body, cookie, csrfToken } = {}) {
  const response = await fetch(`${server.origin}${pathname}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

try {
  const anonymous = await jsonRequest('/api/admin/session');
  if (anonymous.response.status !== 401) throw new Error('Anonymous session request must be rejected');

  const now = Math.floor(Date.now() / 1_000);
  const ticket = signAdminLoginTicket({
    ticketId: 'runtime-http-ticket',
    githubUserId,
    githubLogin: 'jinhwan1030',
    issuedAt: now,
    expiresAt: now + 120,
  }, secret);
  const login = await jsonRequest('/api/admin/session', {
    method: 'POST',
    body: { ticket },
  });
  if (login.response.status !== 200) throw new Error(`Login failed: ${JSON.stringify(login.payload)}`);
  const setCookies = login.response.headers.getSetCookie();
  const sessionToken = cookieValue(setCookies, '__Host-jhwan_admin_session');
  const csrfToken = cookieValue(setCookies, '__Host-jhwan_admin_csrf');
  const cookie = `__Host-jhwan_admin_session=${sessionToken}; __Host-jhwan_admin_csrf=${csrfToken}`;

  const create = await jsonRequest('/api/admin/posts', {
    method: 'POST',
    cookie,
    csrfToken,
    body: {
      slug: 'admin-runtime-published',
      title: 'Administrator runtime fixture',
      description: 'Published through the real Astro HTTP endpoint.',
      bodyMarkdown: '## Administrator runtime fixture',
      category: '개발',
      status: 'published',
      heroImagePath: null,
      publishedAt: null,
    },
  });
  if (create.response.status !== 201) throw new Error(`Post creation failed: ${JSON.stringify(create.payload)}`);
  const detail = await fetch(`${server.origin}/blog/admin-runtime-published/`);
  if (!detail.ok) throw new Error('The administrator-created post was not immediately public');

  const missingCsrf = await jsonRequest(`/api/admin/posts/${create.payload.post.id}`, {
    method: 'PATCH',
    cookie: `__Host-jhwan_admin_session=${sessionToken}`,
    body: { expectedVersion: 1, title: 'Blocked update' },
  });
  if (missingCsrf.response.status !== 403) throw new Error('A write without CSRF must be rejected');

  const replay = await jsonRequest('/api/admin/session', { method: 'POST', body: { ticket } });
  if (replay.response.status !== 401 || replay.payload.error.code !== 'login_ticket_replayed') {
    throw new Error('A used login ticket must not create another session');
  }

  console.log('Administrator runtime validation passed (cookies, CSRF, replay defense, immediate publish)');
} finally {
  await server.stop();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
