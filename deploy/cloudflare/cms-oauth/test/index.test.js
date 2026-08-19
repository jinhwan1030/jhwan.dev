import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { handleRequest } from '../src/index.js';
import { verifyAdminLoginTicket } from '../../../../src/lib/server/admin-auth.js';

const ENV = {
  ADMIN_GITHUB_USER_ID: '12345678',
  ADMIN_LOGIN_TICKET_SECRET: 'test-admin-login-ticket-secret-32-bytes-minimum',
  CMS_ORIGIN: 'https://jhwan.dev',
  GITHUB_OAUTH_ID: 'test-client-id',
  GITHUB_OAUTH_SECRET: 'test-client-secret',
  GITHUB_SCOPE: 'public_repo',
  OAUTH_CALLBACK_URL: 'https://auth.jhwan.dev/callback',
};

function extractState(response) {
  const cookie = response.headers.get('Set-Cookie');
  const match = cookie?.match(/__Host-jhwan_cms_oauth_state=([a-f0-9]{64})/);
  assert.ok(match, 'OAuth state cookie was not set');
  return match[1];
}

function STATE_COOKIE_FOR_TEST(state) {
  return `__Host-jhwan_cms_oauth_state=${state}`;
}

describe('CMS OAuth Worker', () => {
  it('returns a no-store health response', async () => {
    const result = await handleRequest(new Request('https://auth.jhwan.dev/health'), ENV);

    assert.equal(result.status, 200);
    assert.equal(await result.text(), 'jhwan CMS OAuth proxy: ok');
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
  });

  it('rejects unsupported methods', async () => {
    const result = await handleRequest(
      new Request('https://auth.jhwan.dev/auth', { method: 'POST' }),
      ENV,
    );

    assert.equal(result.status, 405);
    assert.equal(result.headers.get('Allow'), 'GET, HEAD');
  });

  it('rejects unknown providers and CMS sites', async () => {
    const providerResult = await handleRequest(
      new Request('https://auth.jhwan.dev/auth?provider=gitlab&site_id=jhwan.dev'),
      ENV,
    );
    const siteResult = await handleRequest(
      new Request('https://auth.jhwan.dev/auth?provider=github&site_id=attacker.example'),
      ENV,
    );

    assert.equal(providerResult.status, 400);
    assert.equal(siteResult.status, 400);
  });

  it('redirects to GitHub with a minimal scope and secure state cookie', async () => {
    const result = await handleRequest(
      new Request(
        'https://auth.jhwan.dev/auth?provider=github&site_id=jhwan.dev&scope=public_repo',
      ),
      ENV,
    );

    assert.equal(result.status, 302);
    const location = new URL(result.headers.get('Location'));
    const state = extractState(result);
    assert.equal(location.origin, 'https://github.com');
    assert.equal(location.pathname, '/login/oauth/authorize');
    assert.equal(location.searchParams.get('client_id'), 'test-client-id');
    assert.equal(location.searchParams.get('redirect_uri'), ENV.OAUTH_CALLBACK_URL);
    assert.equal(location.searchParams.get('scope'), 'public_repo');
    assert.equal(location.searchParams.get('state'), state);
    assert.match(result.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Lax; Max-Age=600/);
  });

  it('starts the administrator flow with an HttpOnly flow marker', async () => {
    const result = await handleRequest(
      new Request('https://auth.jhwan.dev/admin/auth'),
      ENV,
    );

    assert.equal(result.status, 302);
    const location = new URL(result.headers.get('Location'));
    assert.equal(location.origin, 'https://github.com');
    assert.equal(location.searchParams.get('scope'), 'public_repo');
    assert.match(result.headers.get('Set-Cookie'), /__Host-jhwan_cms_oauth_flow=admin/);
  });

  it('accepts the Sveltia scope hint but only requests the minimal GitHub scope', async () => {
    const result = await handleRequest(
      new Request(
        'https://auth.jhwan.dev/auth?provider=github&site_id=jhwan.dev&scope=repo%2Cuser',
      ),
      ENV,
    );

    assert.equal(result.status, 302);
    const location = new URL(result.headers.get('Location'));
    assert.equal(location.searchParams.get('scope'), 'public_repo');
  });

  it('rejects a broader OAuth scope', async () => {
    const result = await handleRequest(
      new Request('https://auth.jhwan.dev/auth?provider=github&site_id=jhwan.dev&scope=repo'),
      ENV,
    );

    assert.equal(result.status, 400);
    assert.equal(await result.text(), 'Invalid OAuth scope');
  });

  it('rejects a broader configured GitHub scope', async () => {
    const originalConsoleError = console.error;
    console.error = () => {};
    let result;
    try {
      result = await handleRequest(
        new Request('https://auth.jhwan.dev/auth?provider=github&site_id=jhwan.dev'),
        { ...ENV, GITHUB_SCOPE: 'repo,user' },
      );
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(result.status, 500);
    assert.equal(await result.text(), 'OAuth proxy configuration error');
  });

  it('rejects callback state mismatches before contacting GitHub', async () => {
    let fetchCalled = false;
    const result = await handleRequest(
      new Request('https://auth.jhwan.dev/callback?code=test-code&state=returned-state', {
        headers: { Cookie: '__Host-jhwan_cms_oauth_state=stored-state' },
      }),
      ENV,
      async () => {
        fetchCalled = true;
        return new Response();
      },
    );

    assert.equal(result.status, 400);
    assert.equal(fetchCalled, false);
    assert.match(await result.text(), /authorization:github:error/);
  });

  it('exchanges the code and completes the CMS handshake', async () => {
    const authResult = await handleRequest(
      new Request('https://auth.jhwan.dev/auth?provider=github&site_id=jhwan.dev'),
      ENV,
    );
    const state = extractState(authResult);
    let tokenRequest;

    const result = await handleRequest(
      new Request(`https://auth.jhwan.dev/callback?code=test-code&state=${state}`, {
        headers: { Cookie: `__Host-jhwan_cms_oauth_state=${state}` },
      }),
      ENV,
      async (url, init) => {
        tokenRequest = { url, init };
        return Response.json({ access_token: 'github-token' });
      },
    );

    assert.equal(result.status, 200);
    assert.equal(tokenRequest.url, 'https://github.com/login/oauth/access_token');
    assert.equal(tokenRequest.init.method, 'POST');
    assert.equal(tokenRequest.init.body.get('client_secret'), 'test-client-secret');
    assert.equal(tokenRequest.init.body.get('redirect_uri'), ENV.OAUTH_CALLBACK_URL);

    const html = await result.text();
    assert.match(html, /authorization:github:success/);
    assert.match(html, /github-token/);
    assert.match(html, /https:\/\/jhwan\.dev/);
    assert.match(result.headers.get('Content-Security-Policy'), /script-src 'nonce-/);
    assert.match(result.headers.get('Set-Cookie'), /Max-Age=0/);
  });

  it('verifies the GitHub identity and redirects with a short-lived administrator ticket', async () => {
    const authResult = await handleRequest(
      new Request('https://auth.jhwan.dev/admin/auth'),
      ENV,
    );
    const state = extractState(authResult);
    const requestedUrls = [];
    const result = await handleRequest(
      new Request(`https://auth.jhwan.dev/callback?code=admin-code&state=${state}`, {
        headers: {
          Cookie: `${STATE_COOKIE_FOR_TEST(state)}; __Host-jhwan_cms_oauth_flow=admin`,
        },
      }),
      ENV,
      async (url) => {
        requestedUrls.push(String(url));
        if (url === 'https://github.com/login/oauth/access_token') {
          return Response.json({ access_token: 'server-only-github-token' });
        }
        if (url === 'https://api.github.com/user') {
          return Response.json({ id: 12345678, login: 'jinhwan1030' });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    );

    assert.equal(result.status, 303);
    assert.deepEqual(requestedUrls, [
      'https://github.com/login/oauth/access_token',
      'https://api.github.com/user',
    ]);
    const location = new URL(result.headers.get('Location'));
    assert.equal(location.origin, 'https://jhwan.dev');
    assert.equal(location.pathname, '/admin/');
    const ticket = new URLSearchParams(location.hash.slice(1)).get('ticket');
    const identity = verifyAdminLoginTicket(ticket, ENV.ADMIN_LOGIN_TICKET_SECRET);
    assert.equal(identity.githubUserId, ENV.ADMIN_GITHUB_USER_ID);
    assert.equal(identity.githubLogin, 'jinhwan1030');
    assert.ok(identity.expiresAt - identity.issuedAt <= 120);
    assert.doesNotMatch(result.headers.get('Location'), /server-only-github-token/);
  });

  it('does not issue an administrator ticket to another GitHub account', async () => {
    const authResult = await handleRequest(
      new Request('https://auth.jhwan.dev/admin/auth'),
      ENV,
    );
    const state = extractState(authResult);
    const result = await handleRequest(
      new Request(`https://auth.jhwan.dev/callback?code=admin-code&state=${state}`, {
        headers: {
          Cookie: `${STATE_COOKIE_FOR_TEST(state)}; __Host-jhwan_cms_oauth_flow=admin`,
        },
      }),
      ENV,
      async (url) => url === 'https://github.com/login/oauth/access_token'
        ? Response.json({ access_token: 'server-only-github-token' })
        : Response.json({ id: 99999999, login: 'not-the-admin' }),
    );

    assert.equal(result.status, 403);
    assert.equal(await result.text(), 'GitHub account is not an administrator');
  });

  it('does not expose secrets when GitHub rejects the token request', async () => {
    const authResult = await handleRequest(
      new Request('https://auth.jhwan.dev/auth?provider=github&site_id=jhwan.dev'),
      ENV,
    );
    const state = extractState(authResult);
    const originalConsoleError = console.error;
    console.error = () => {};
    let result;
    try {
      result = await handleRequest(
        new Request(`https://auth.jhwan.dev/callback?code=bad-code&state=${state}`, {
          headers: { Cookie: `__Host-jhwan_cms_oauth_state=${state}` },
        }),
        ENV,
        async () => Response.json(
          { error: 'bad_verification_code', error_description: 'The code is incorrect.' },
          { status: 401 },
        ),
      );
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(result.status, 502);
    const html = await result.text();
    assert.match(html, /authorization:github:error/);
    assert.doesNotMatch(html, /test-client-secret/);
  });
});
