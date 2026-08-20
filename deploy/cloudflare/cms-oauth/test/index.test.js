import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { handleRequest } from '../src/index.js';

const ENV = {
  GITHUB_OAUTH_ID: 'client-id',
  GITHUB_OAUTH_SECRET: 'client-secret',
  GITHUB_SCOPE: 'read:user',
  CMS_ORIGIN: 'https://jhwan.dev',
  OAUTH_CALLBACK_URL: 'https://cms-oauth.jhwan.dev/callback',
  ADMIN_GITHUB_USER_ID: '12345678',
  ADMIN_LOGIN_TICKET_SECRET: 'a-test-secret-that-is-longer-than-thirty-two-characters',
};

function extractState(response) {
  const cookie = response.headers.get('Set-Cookie');
  const match = cookie?.match(/__Host-jhwan_admin_oauth_state=([^;]+)/);
  assert.ok(match, 'OAuth state cookie should be set');
  return match[1];
}

function request(path, init) {
  return new Request(`https://cms-oauth.jhwan.dev${path}`, init);
}

describe('administrator OAuth worker', () => {
  it('exposes health and retires the legacy CMS token endpoint', async () => {
    const health = await handleRequest(request('/health'), ENV);
    assert.equal(health.status, 200);
    assert.match(await health.text(), /administrator OAuth: ok/);

    const legacy = await handleRequest(request('/auth'), ENV);
    assert.equal(legacy.status, 410);
  });

  it('rejects unsupported methods', async () => {
    const response = await handleRequest(request('/admin/auth', { method: 'POST' }), ENV);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, HEAD');
  });

  it('starts GitHub login with only read:user and a secure state cookie', async () => {
    const response = await handleRequest(request('/admin/auth'), ENV);
    assert.equal(response.status, 302);

    const location = new URL(response.headers.get('Location'));
    assert.equal(location.origin, 'https://github.com');
    assert.equal(location.pathname, '/login/oauth/authorize');
    assert.equal(location.searchParams.get('scope'), 'read:user');
    assert.equal(location.searchParams.get('client_id'), ENV.GITHUB_OAUTH_ID);
    assert.ok(location.searchParams.get('state'));

    const cookie = response.headers.get('Set-Cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
  });

  it('rejects a broader configured GitHub scope', async () => {
    const response = await handleRequest(request('/admin/auth'), {
      ...ENV,
      GITHUB_SCOPE: 'public_repo',
    });
    assert.equal(response.status, 500);
    assert.equal(await response.text(), 'OAuth proxy configuration error');
  });

  it('rejects callback state mismatches without contacting GitHub', async () => {
    let fetchCalls = 0;
    const response = await handleRequest(
      request('/callback?code=code&state=returned', {
        headers: { Cookie: '__Host-jhwan_admin_oauth_state=stored' },
      }),
      ENV,
      async () => {
        fetchCalls += 1;
        throw new Error('must not be called');
      },
    );
    assert.equal(response.status, 400);
    assert.equal(fetchCalls, 0);
    assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
  });

  it('verifies the GitHub identity and returns only a short-lived admin ticket', async () => {
    const start = await handleRequest(request('/admin/auth'), ENV);
    const state = extractState(start);
    const fetchCalls = [];
    const fetchImpl = async (url, init) => {
      fetchCalls.push({ url, init });
      if (url === 'https://github.com/login/oauth/access_token') {
        return Response.json({ access_token: 'server-only-github-token' });
      }
      if (url === 'https://api.github.com/user') {
        return Response.json({ id: Number(ENV.ADMIN_GITHUB_USER_ID), login: 'jinhwan' });
      }
      throw new Error(`unexpected URL: ${url}`);
    };

    const response = await handleRequest(
      request(`/callback?code=one-time-code&state=${state}`, {
        headers: { Cookie: `__Host-jhwan_admin_oauth_state=${state}` },
      }),
      ENV,
      fetchImpl,
    );

    assert.equal(response.status, 303);
    assert.equal(fetchCalls.length, 2);
    const location = new URL(response.headers.get('Location'));
    assert.equal(location.origin, ENV.CMS_ORIGIN);
    assert.equal(location.pathname, '/admin/');
    assert.equal(location.search, '');
    const ticket = new URLSearchParams(location.hash.slice(1)).get('ticket');
    assert.equal(ticket?.split('.').length, 3);
    assert.doesNotMatch(location.href, /server-only-github-token/);
    assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
  });

  it('rejects a GitHub identity outside the administrator allowlist', async () => {
    const start = await handleRequest(request('/admin/auth'), ENV);
    const state = extractState(start);
    const responses = [
      Response.json({ access_token: 'server-only-github-token' }),
      Response.json({ id: 999, login: 'someone-else' }),
    ];
    const response = await handleRequest(
      request(`/callback?code=code&state=${state}`, {
        headers: { Cookie: `__Host-jhwan_admin_oauth_state=${state}` },
      }),
      ENV,
      async () => responses.shift(),
    );
    assert.equal(response.status, 403);
    assert.doesNotMatch(await response.text(), /token|999|someone-else/i);
  });

  it('does not expose GitHub errors or secrets to the browser', async () => {
    const start = await handleRequest(request('/admin/auth'), ENV);
    const state = extractState(start);
    const response = await handleRequest(
      request(`/callback?code=code&state=${state}`, {
        headers: { Cookie: `__Host-jhwan_admin_oauth_state=${state}` },
      }),
      ENV,
      async () => Response.json(
        { error: 'bad_verification_code', error_description: ENV.GITHUB_OAUTH_SECRET },
        { status: 400 },
      ),
    );
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.equal(body, 'GitHub login failed');
    assert.doesNotMatch(body, new RegExp(ENV.GITHUB_OAUTH_SECRET));
  });
});
