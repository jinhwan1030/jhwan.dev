const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const STATE_COOKIE = '__Host-jhwan_cms_oauth_state';
const FLOW_COOKIE = '__Host-jhwan_cms_oauth_flow';
const STATE_MAX_AGE_SECONDS = 600;
const MINIMUM_GITHUB_SCOPE = 'public_repo';
const SVELTIA_GITHUB_SCOPE_HINT = 'repo,user';

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

function response(body, init = {}) {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(BASE_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(body, { ...init, headers });
}

function textResponse(message, status = 200) {
  return response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function randomHex(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseCookies(headerValue) {
  if (!headerValue) return new Map();

  return new Map(
    headerValue
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf('=');
        if (separator === -1) return [part, ''];
        return [part.slice(0, separator), part.slice(separator + 1)];
      }),
  );
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function stateCookie(value, maxAge = STATE_MAX_AGE_SECONDS) {
  return `${STATE_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function flowCookie(value, maxAge = STATE_MAX_AGE_SECONDS) {
  return `${FLOW_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function appendFlowCookies(result, state, flow, maxAge = STATE_MAX_AGE_SECONDS) {
  result.headers.append('Set-Cookie', stateCookie(state, maxAge));
  result.headers.append('Set-Cookie', flowCookie(flow, maxAge));
  return result;
}

function requireEnvironment(env) {
  const required = ['GITHUB_OAUTH_ID', 'GITHUB_OAUTH_SECRET', 'CMS_ORIGIN', 'OAUTH_CALLBACK_URL'];
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment bindings: ${missing.join(', ')}`);
  }

  const cmsOrigin = new URL(env.CMS_ORIGIN);
  const callbackUrl = new URL(env.OAUTH_CALLBACK_URL);
  if (cmsOrigin.protocol !== 'https:' || callbackUrl.protocol !== 'https:') {
    throw new Error('CMS_ORIGIN and OAUTH_CALLBACK_URL must use HTTPS');
  }
  if (callbackUrl.pathname !== '/callback' || callbackUrl.search || callbackUrl.hash) {
    throw new Error('OAUTH_CALLBACK_URL must end with the exact /callback path');
  }

  const githubScope = env.GITHUB_SCOPE || MINIMUM_GITHUB_SCOPE;
  if (githubScope !== MINIMUM_GITHUB_SCOPE) {
    throw new Error(`GITHUB_SCOPE must be ${MINIMUM_GITHUB_SCOPE}`);
  }

  return {
    callbackUrl,
    cmsOrigin,
    githubScope,
  };
}

function requireAdminEnvironment(env) {
  const { cmsOrigin } = requireEnvironment(env);
  if (!/^\d+$/.test(env.ADMIN_GITHUB_USER_ID ?? '')) {
    throw new Error('ADMIN_GITHUB_USER_ID must be a numeric GitHub user ID');
  }
  if (typeof env.ADMIN_LOGIN_TICKET_SECRET !== 'string' || env.ADMIN_LOGIN_TICKET_SECRET.length < 32) {
    throw new Error('ADMIN_LOGIN_TICKET_SECRET must contain at least 32 characters');
  }
  return { adminOrigin: cmsOrigin };
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
}

function callbackPage(env, status, payload, httpStatus = 200) {
  const { cmsOrigin } = requireEnvironment(env);
  const nonce = randomHex(16);
  const authorizationMessage = `authorization:github:${status}:${JSON.stringify(payload)}`;
  const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <title>jhwan.dev GitHub 로그인</title>
  </head>
  <body>
    <p id="status">GitHub 로그인을 마무리하는 중입니다.</p>
    <script nonce="${nonce}">
      const targetOrigin = ${safeJson(cmsOrigin.origin)};
      const authorizationMessage = ${safeJson(authorizationMessage)};
      const statusElement = document.getElementById('status');

      if (!window.opener) {
        statusElement.textContent = '관리자 화면에서 로그인을 다시 시작해주세요.';
      } else {
        const receiveMessage = (event) => {
          if (event.origin !== targetOrigin || event.source !== window.opener) return;
          window.opener.postMessage(authorizationMessage, targetOrigin);
          window.removeEventListener('message', receiveMessage, false);
        };

        window.addEventListener('message', receiveMessage, false);
        window.opener.postMessage('authorizing:github', targetOrigin);
      }
    </script>
  </body>
</html>`;

  const result = response(html, {
    status: httpStatus,
    headers: {
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
  return appendFlowCookies(result, '', '', 0);
}

async function handleAuth(url, env) {
  const { callbackUrl, cmsOrigin, githubScope } = requireEnvironment(env);
  if (url.searchParams.get('provider') !== 'github') {
    return textResponse('Invalid OAuth provider', 400);
  }

  if (url.searchParams.get('site_id') !== cmsOrigin.hostname) {
    return textResponse('Invalid CMS site', 400);
  }

  const requestedScope = url.searchParams.get('scope');
  if (
    requestedScope
    && requestedScope !== githubScope
    && requestedScope !== SVELTIA_GITHUB_SCOPE_HINT
  ) {
    return textResponse('Invalid OAuth scope', 400);
  }

  const state = randomHex();
  const authorizationUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizationUrl.search = new URLSearchParams({
    client_id: env.GITHUB_OAUTH_ID,
    redirect_uri: callbackUrl.href,
    response_type: 'code',
    scope: githubScope,
    state,
  }).toString();

  const result = response(null, {
    status: 302,
    headers: {
      Location: authorizationUrl.href,
    },
  });
  return appendFlowCookies(result, state, 'cms');
}

async function handleAdminAuth(env) {
  const { callbackUrl, githubScope } = requireEnvironment(env);
  requireAdminEnvironment(env);
  const state = randomHex();
  const authorizationUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizationUrl.search = new URLSearchParams({
    client_id: env.GITHUB_OAUTH_ID,
    redirect_uri: callbackUrl.href,
    response_type: 'code',
    scope: githubScope,
    state,
  }).toString();
  const result = response(null, {
    status: 302,
    headers: { Location: authorizationUrl.href },
  });
  return appendFlowCookies(result, state, 'admin');
}

async function exchangeCodeForToken(code, env, fetchImpl) {
  const { callbackUrl } = requireEnvironment(env);
  const tokenResponse = await fetchImpl(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'jhwan-cms-oauth',
    },
    body: new URLSearchParams({
      client_id: env.GITHUB_OAUTH_ID,
      client_secret: env.GITHUB_OAUTH_SECRET,
      code,
      redirect_uri: callbackUrl.href,
    }),
  });

  let tokenResult;
  try {
    tokenResult = await tokenResponse.json();
  } catch {
    throw new Error('GitHub returned an invalid token response');
  }

  if (!tokenResponse.ok || !tokenResult.access_token) {
    throw new Error(tokenResult.error_description || tokenResult.error || 'GitHub token exchange failed');
  }
  return tokenResult.access_token;
}

async function loadGithubIdentity(token, fetchImpl) {
  const userResponse = await fetchImpl(GITHUB_USER_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'jhwan-admin-oauth',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const user = await userResponse.json();
  if (!userResponse.ok || !Number.isInteger(user.id) || typeof user.login !== 'string') {
    throw new Error('GitHub identity verification failed');
  }
  return { id: String(user.id), login: user.login };
}

function base64UrlEncode(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function signAdminLoginTicket(identity, secret, now = Date.now()) {
  const issuedAt = Math.floor(now / 1_000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({
    iss: 'jhwan-cms-oauth',
    aud: 'jhwan-admin',
    purpose: 'admin-login',
    jti: randomHex(16),
    sub: identity.id,
    login: identity.login,
    iat: issuedAt,
    exp: issuedAt + 120,
  }));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

async function adminCallback(token, env, fetchImpl) {
  const { adminOrigin } = requireAdminEnvironment(env);
  const identity = await loadGithubIdentity(token, fetchImpl);
  if (identity.id !== env.ADMIN_GITHUB_USER_ID) {
    return appendFlowCookies(textResponse('GitHub account is not an administrator', 403), '', '', 0);
  }
  const ticket = await signAdminLoginTicket(identity, env.ADMIN_LOGIN_TICKET_SECRET);
  const location = new URL('/admin/', adminOrigin);
  location.hash = new URLSearchParams({ ticket }).toString();
  const result = response(null, {
    status: 303,
    headers: {
      Location: location.href,
      'Referrer-Policy': 'no-referrer',
    },
  });
  return appendFlowCookies(result, '', '', 0);
}

async function handleCallback(request, url, env, fetchImpl) {
  requireEnvironment(env);
  const returnedState = url.searchParams.get('state');
  const storedState = parseCookies(request.headers.get('Cookie')).get(STATE_COOKIE);
  if (!constantTimeEqual(returnedState, storedState)) {
    return callbackPage(env, 'error', { message: 'OAuth state verification failed' }, 400);
  }

  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    return callbackPage(env, 'error', {
      message: url.searchParams.get('error_description') || oauthError,
    }, 400);
  }

  const code = url.searchParams.get('code');
  if (!code) {
    return callbackPage(env, 'error', { message: 'Missing OAuth authorization code' }, 400);
  }

  try {
    const token = await exchangeCodeForToken(code, env, fetchImpl);
    const flow = parseCookies(request.headers.get('Cookie')).get(FLOW_COOKIE) ?? 'cms';
    if (flow === 'admin') return await adminCallback(token, env, fetchImpl);
    return callbackPage(env, 'success', { token });
  } catch (error) {
    console.error('GitHub OAuth token exchange failed');
    return callbackPage(env, 'error', {
      message: error instanceof Error ? error.message : 'GitHub login failed',
    }, 502);
  }
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const url = new URL(request.url);
  try {
    if (url.pathname === '/' || url.pathname === '/health') {
      return textResponse('jhwan CMS OAuth proxy: ok');
    }
    if (url.pathname === '/auth') {
      return await handleAuth(url, env);
    }
    if (url.pathname === '/admin/auth') {
      return await handleAdminAuth(env);
    }
    if (url.pathname === '/callback') {
      return await handleCallback(request, url, env, fetchImpl);
    }
    return textResponse('Not found', 404);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Unexpected OAuth proxy error');
    return textResponse('OAuth proxy configuration error', 500);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
