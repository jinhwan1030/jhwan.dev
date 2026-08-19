import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { signAdminLoginTicket } from '../src/lib/server/admin-auth.js';
import { closeAdminRuntime } from '../src/lib/server/admin-runtime.js';
import { closeContentRuntime, getContentRuntime } from '../src/lib/server/content-runtime.js';
import * as postRoute from '../src/pages/api/admin/posts/[id].js';
import * as postsRoute from '../src/pages/api/admin/posts/index.js';
import * as sessionRoute from '../src/pages/api/admin/session.js';

const SECRET = 'runtime-admin-ticket-secret-at-least-32-bytes';

function jsonRequest(url, method, body, cookie, csrfToken) {
  return new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function cookieValue(setCookies, name) {
  const prefix = `${name}=`;
  const cookie = setCookies.find((value) => value.startsWith(prefix));
  assert.ok(cookie, `${name} cookie missing`);
  return cookie.split(';', 1)[0].slice(prefix.length);
}

test('administrator HTTP routes exchange a ticket and persist a published post', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-admin-http-'));
  const previousEnvironment = {
    JHWAN_ADMIN_ENABLED: process.env.JHWAN_ADMIN_ENABLED,
    JHWAN_DATABASE_PATH: process.env.JHWAN_DATABASE_PATH,
    JHWAN_CONTENT_SEED_PATH: process.env.JHWAN_CONTENT_SEED_PATH,
    ADMIN_GITHUB_USER_ID: process.env.ADMIN_GITHUB_USER_ID,
    ADMIN_LOGIN_TICKET_SECRET: process.env.ADMIN_LOGIN_TICKET_SECRET,
  };
  Object.assign(process.env, {
    JHWAN_ADMIN_ENABLED: 'true',
    JHWAN_DATABASE_PATH: path.join(directory, 'content.db'),
    JHWAN_CONTENT_SEED_PATH: path.resolve('src/content/blog'),
    ADMIN_GITHUB_USER_ID: '12345678',
    ADMIN_LOGIN_TICKET_SECRET: SECRET,
  });
  context.after(() => {
    closeAdminRuntime();
    closeContentRuntime();
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const now = Math.floor(Date.now() / 1_000);
  const ticket = signAdminLoginTicket({
    ticketId: 'runtime-ticket-id',
    githubUserId: '12345678',
    githubLogin: 'jinhwan1030',
    issuedAt: now,
    expiresAt: now + 120,
  }, SECRET);
  const loginResponse = await sessionRoute.POST({
    request: jsonRequest('https://jhwan.dev/api/admin/session', 'POST', { ticket }),
  });
  assert.equal(loginResponse.status, 200);
  const setCookies = loginResponse.headers.getSetCookie();
  const sessionToken = cookieValue(setCookies, '__Host-jhwan_admin_session');
  const csrfToken = cookieValue(setCookies, '__Host-jhwan_admin_csrf');
  const cookies = `__Host-jhwan_admin_session=${sessionToken}; __Host-jhwan_admin_csrf=${csrfToken}`;

  const createResponse = await postsRoute.POST({
    request: jsonRequest('https://jhwan.dev/api/admin/posts', 'POST', {
      slug: 'runtime-published-post',
      title: '즉시 공개 글',
      description: 'DB 저장 직후 공개 조회에 나타나는지 확인합니다.',
      bodyMarkdown: '## 새 본문',
      category: '개발',
      status: 'published',
      heroImagePath: null,
      publishedAt: null,
    }, cookies, csrfToken),
  });
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()).post;
  assert.equal(created.version, 1);
  assert.equal(getContentRuntime().repository.findPublishedBySlug(created.slug).title, '즉시 공개 글');

  const staleUpdate = await postRoute.PATCH({
    params: { id: created.id },
    request: jsonRequest(`https://jhwan.dev/api/admin/posts/${created.id}`, 'PATCH', {
      expectedVersion: 99,
      title: '충돌',
    }, cookies, csrfToken),
  });
  assert.equal(staleUpdate.status, 409);
  assert.equal((await staleUpdate.json()).error.code, 'version_conflict');

  const missingCsrf = await postRoute.PATCH({
    params: { id: created.id },
    request: jsonRequest(`https://jhwan.dev/api/admin/posts/${created.id}`, 'PATCH', {
      expectedVersion: created.version,
      title: '허용되지 않은 수정',
    }, `__Host-jhwan_admin_session=${sessionToken}`),
  });
  assert.equal(missingCsrf.status, 403);
});
