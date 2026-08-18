import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { handleRequest } from '../src/index.js';

const ENV = {
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

  it('rejects a broader OAuth scope', async () => {
    const result = await handleRequest(
      new Request('https://auth.jhwan.dev/auth?provider=github&site_id=jhwan.dev&scope=repo'),
      ENV,
    );

    assert.equal(result.status, 400);
    assert.equal(await result.text(), 'Invalid OAuth scope');
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
