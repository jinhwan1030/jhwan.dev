const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const STATE_COOKIE = '__Host-jhwan_admin_oauth_state';
const STATE_MAX_AGE_SECONDS = 600;
const GITHUB_SCOPE = 'read:user';

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
        return separator === -1
          ? [part, '']
          : [part.slice(0, separator), part.slice(separator + 1)];
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

function withClearedState(result) {
  result.headers.append('Set-Cookie', stateCookie('', 0));
  return result;
}

function requireEnvironment(env) {
  const required = [
    'GITHUB_OAUTH_ID',
    'GITHUB_OAUTH_SECRET',
    'CMS_ORIGIN',
    'OAUTH_CALLBACK_URL',
    'ADMIN_GITHUB_USER_ID',
    'ADMIN_LOGIN_TICKET_SECRET',
  ];
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment bindings: ${missing.join(', ')}`);
  }

  const adminOrigin = new URL(env.CMS_ORIGIN);
  const callbackUrl = new URL(env.OAUTH_CALLBACK_URL);
  if (adminOrigin.protocol !== 'https:' || callbackUrl.protocol !== 'https:') {
    throw new Error('CMS_ORIGIN and OAUTH_CALLBACK_URL must use HTTPS');
  }
  if (callbackUrl.pathname !== '/callback' || callbackUrl.search || callbackUrl.hash) {
    throw new Error('OAUTH_CALLBACK_URL must end with the exact /callback path');
  }
  if ((env.GITHUB_SCOPE || GITHUB_SCOPE) !== GITHUB_SCOPE) {
    throw new Error(`GITHUB_SCOPE must be ${GITHUB_SCOPE}`);
  }
  if (!/^\d+$/.test(env.ADMIN_GITHUB_USER_ID)) {
    throw new Error('ADMIN_GITHUB_USER_ID must be a numeric GitHub user ID');
  }
  if (env.ADMIN_LOGIN_TICKET_SECRET.length < 32) {
    throw new Error('ADMIN_LOGIN_TICKET_SECRET must contain at least 32 characters');
  }
  return { adminOrigin, callbackUrl };
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

async function handleAdminAuth(env) {
  const { callbackUrl } = requireEnvironment(env);
  const state = randomHex();
  const authorizationUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizationUrl.search = new URLSearchParams({
    client_id: env.GITHUB_OAUTH_ID,
    redirect_uri: callbackUrl.href,
    response_type: 'code',
    scope: GITHUB_SCOPE,
    state,
  }).toString();
  const result = response(null, { status: 302, headers: { Location: authorizationUrl.href } });
  result.headers.append('Set-Cookie', stateCookie(state));
  return result;
}

async function exchangeCodeForToken(code, env, fetchImpl) {
  const { callbackUrl } = requireEnvironment(env);
  const tokenResponse = await fetchImpl(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'jhwan-admin-oauth',
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

async function handleCallback(request, url, env, fetchImpl) {
  const { adminOrigin } = requireEnvironment(env);
  const returnedState = url.searchParams.get('state');
  const storedState = parseCookies(request.headers.get('Cookie')).get(STATE_COOKIE);
  if (!constantTimeEqual(returnedState, storedState)) {
    return withClearedState(textResponse('OAuth state verification failed', 400));
  }
  if (url.searchParams.get('error')) {
    return withClearedState(textResponse('GitHub login was cancelled', 400));
  }
  const code = url.searchParams.get('code');
  if (!code) return withClearedState(textResponse('Missing OAuth authorization code', 400));

  try {
    const token = await exchangeCodeForToken(code, env, fetchImpl);
    const identity = await loadGithubIdentity(token, fetchImpl);
    if (identity.id !== env.ADMIN_GITHUB_USER_ID) {
      return withClearedState(textResponse('GitHub account is not an administrator', 403));
    }
    const ticket = await signAdminLoginTicket(identity, env.ADMIN_LOGIN_TICKET_SECRET);
    const location = new URL('/admin/', adminOrigin);
    location.hash = new URLSearchParams({ ticket }).toString();
    return withClearedState(response(null, {
      status: 303,
      headers: { Location: location.href },
    }));
  } catch {
    console.error('GitHub administrator OAuth failed');
    return withClearedState(textResponse('GitHub login failed', 502));
  }
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const url = new URL(request.url);
  try {
    if (url.pathname === '/' || url.pathname === '/health') {
      return textResponse('jhwan administrator OAuth: ok');
    }
    if (url.pathname === '/admin/auth') return await handleAdminAuth(env);
    if (url.pathname === '/callback') return await handleCallback(request, url, env, fetchImpl);
    if (url.pathname === '/auth') return textResponse('Legacy CMS OAuth is no longer available', 410);
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
