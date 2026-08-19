import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { withImmediateTransaction } from './database.js';

export const ADMIN_SESSION_COOKIE = '__Host-jhwan_admin_session';
export const DEFAULT_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const LOGIN_TICKET_ISSUER = 'jhwan-cms-oauth';
const LOGIN_TICKET_AUDIENCE = 'jhwan-admin';
const LOGIN_TICKET_PURPOSE = 'admin-login';
const CLOCK_SKEW_SECONDS = 30;

export class AuthenticationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthenticationError';
    this.code = code;
  }
}

function assertSecret(secret, name) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
    throw new Error(`${name} must contain at least 32 bytes`);
  }
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeJson(value) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new AuthenticationError('invalid_login_ticket', 'Login ticket is malformed');
  }
}

export function signAdminLoginTicket(
  { ticketId, githubUserId, githubLogin, issuedAt, expiresAt },
  secret,
) {
  assertSecret(secret, 'ADMIN_LOGIN_TICKET_SECRET');
  const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeJson({
    iss: LOGIN_TICKET_ISSUER,
    aud: LOGIN_TICKET_AUDIENCE,
    purpose: LOGIN_TICKET_PURPOSE,
    jti: ticketId,
    sub: String(githubUserId),
    login: githubLogin,
    iat: issuedAt,
    exp: expiresAt,
  });
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign(unsigned, secret)}`;
}

export function verifyAdminLoginTicket(ticket, secret, now = Date.now()) {
  assertSecret(secret, 'ADMIN_LOGIN_TICKET_SECRET');
  if (typeof ticket !== 'string') {
    throw new AuthenticationError('invalid_login_ticket', 'Login ticket is missing');
  }

  const parts = ticket.split('.');
  if (parts.length !== 3) {
    throw new AuthenticationError('invalid_login_ticket', 'Login ticket is malformed');
  }
  const [encodedHeader, encodedPayload, signature] = parts;
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  if (!safeEqual(signature, sign(unsigned, secret))) {
    throw new AuthenticationError('invalid_login_ticket', 'Login ticket signature is invalid');
  }

  const header = decodeJson(encodedHeader);
  const payload = decodeJson(encodedPayload);
  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    throw new AuthenticationError('invalid_login_ticket', 'Login ticket header is invalid');
  }
  if (
    payload.iss !== LOGIN_TICKET_ISSUER
    || payload.aud !== LOGIN_TICKET_AUDIENCE
    || payload.purpose !== LOGIN_TICKET_PURPOSE
  ) {
    throw new AuthenticationError('invalid_login_ticket', 'Login ticket claims are invalid');
  }
  if (
    typeof payload.jti !== 'string'
    || !/^[A-Za-z0-9_-]{8,128}$/.test(payload.jti)
    || !/^\d+$/.test(payload.sub)
    || typeof payload.login !== 'string'
    || !/^[A-Za-z0-9-]{1,39}$/.test(payload.login)
    || !Number.isInteger(payload.iat)
    || !Number.isInteger(payload.exp)
  ) {
    throw new AuthenticationError('invalid_login_ticket', 'Login ticket identity is invalid');
  }

  const nowSeconds = Math.floor(now / 1_000);
  if (payload.iat > nowSeconds + CLOCK_SKEW_SECONDS || payload.exp <= nowSeconds) {
    throw new AuthenticationError('expired_login_ticket', 'Login ticket has expired');
  }
  if (payload.exp <= payload.iat || payload.exp - payload.iat > 5 * 60) {
    throw new AuthenticationError('invalid_login_ticket', 'Login ticket lifetime is too long');
  }

  return {
    ticketId: payload.jti,
    githubUserId: payload.sub,
    githubLogin: payload.login,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    githubUserId: row.github_user_id,
    githubLogin: row.github_login,
    csrfTokenHash: row.csrf_token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export function createAdminAuth(
  database,
  {
    allowedGithubUserId,
    loginTicketSecret,
    sessionMaxAgeSeconds = DEFAULT_SESSION_MAX_AGE_SECONDS,
    clock = () => Date.now(),
    tokenGenerator = () => randomBytes(32).toString('base64url'),
    idGenerator = randomUUID,
  },
) {
  if (!/^\d+$/.test(String(allowedGithubUserId))) {
    throw new Error('ADMIN_GITHUB_USER_ID must be a numeric GitHub user ID');
  }
  assertSecret(loginTicketSecret, 'ADMIN_LOGIN_TICKET_SECRET');
  if (!Number.isInteger(sessionMaxAgeSeconds) || sessionMaxAgeSeconds < 300 || sessionMaxAgeSeconds > 86_400) {
    throw new Error('Admin session lifetime must be between 5 minutes and 24 hours');
  }

  const insertSession = database.prepare(`
    INSERT INTO admin_sessions (
      id, token_hash, csrf_token_hash, login_ticket_id, github_user_id, github_login,
      created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findSession = database.prepare(`
    SELECT * FROM admin_sessions
    WHERE token_hash = ? AND revoked_at IS NULL
  `);
  const revokeSession = database.prepare(`
    UPDATE admin_sessions SET revoked_at = ?
    WHERE token_hash = ? AND revoked_at IS NULL
  `);
  const deleteExpiredSessions = database.prepare(
    'DELETE FROM admin_sessions WHERE expires_at <= ?',
  );

  function exchangeLoginTicket(ticket) {
    const identity = verifyAdminLoginTicket(ticket, loginTicketSecret, clock());
    if (identity.githubUserId !== String(allowedGithubUserId)) {
      throw new AuthenticationError('admin_not_allowed', 'GitHub account is not an administrator');
    }

    const sessionToken = tokenGenerator();
    const csrfToken = tokenGenerator();
    if (sessionToken === csrfToken || sessionToken.length < 32 || csrfToken.length < 32) {
      throw new Error('Secure session token generation failed');
    }
    const createdAt = new Date(clock()).toISOString();
    const expiresAt = new Date(clock() + sessionMaxAgeSeconds * 1_000).toISOString();
    const session = {
      id: idGenerator(),
      githubUserId: identity.githubUserId,
      githubLogin: identity.githubLogin,
      createdAt,
      expiresAt,
      revokedAt: null,
    };

    try {
      withImmediateTransaction(database, () => {
        insertSession.run(
          session.id,
          hash(sessionToken),
          hash(csrfToken),
          identity.ticketId,
          session.githubUserId,
          session.githubLogin,
          createdAt,
          expiresAt,
        );
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('admin_sessions.login_ticket_id')) {
        throw new AuthenticationError('login_ticket_replayed', 'Login ticket was already used');
      }
      throw error;
    }

    return { sessionToken, csrfToken, session };
  }

  function verifySession(sessionToken) {
    if (typeof sessionToken !== 'string' || sessionToken.length < 32) {
      throw new AuthenticationError('session_required', 'Administrator session is missing');
    }
    const session = mapSession(findSession.get(hash(sessionToken)));
    if (!session) throw new AuthenticationError('invalid_session', 'Administrator session is invalid');
    if (Date.parse(session.expiresAt) <= clock()) {
      throw new AuthenticationError('expired_session', 'Administrator session has expired');
    }
    return session;
  }

  function verifyCsrf(session, csrfToken) {
    if (typeof csrfToken !== 'string' || !safeEqual(hash(csrfToken), session.csrfTokenHash)) {
      throw new AuthenticationError('invalid_csrf_token', 'CSRF token is invalid');
    }
  }

  return {
    exchangeLoginTicket,
    verifySession,
    verifyCsrf,

    revoke(sessionToken) {
      if (typeof sessionToken !== 'string') return false;
      const result = revokeSession.run(new Date(clock()).toISOString(), hash(sessionToken));
      return result.changes === 1;
    },

    prune() {
      return deleteExpiredSessions.run(new Date(clock()).toISOString()).changes;
    },
  };
}

export function serializeAdminSessionCookie(sessionToken, maxAge = DEFAULT_SESSION_MAX_AGE_SECONDS) {
  return `${ADMIN_SESSION_COOKIE}=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function clearAdminSessionCookie() {
  return `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
