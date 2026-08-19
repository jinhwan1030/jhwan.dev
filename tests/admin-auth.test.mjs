import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_SESSION_COOKIE,
  AuthenticationError,
  clearAdminSessionCookie,
  createAdminAuth,
  serializeAdminSessionCookie,
  signAdminLoginTicket,
  verifyAdminLoginTicket,
} from '../src/lib/server/admin-auth.js';
import { openDatabase } from '../src/lib/server/database.js';
import { migrateDatabase } from '../src/lib/server/migrations.js';

const TICKET_SECRET = 'ticket-secret-that-is-at-least-32-bytes-long';
const NOW = Date.parse('2026-08-19T05:00:00.000Z');

function loginTicket(overrides = {}) {
  const nowSeconds = Math.floor(NOW / 1_000);
  return signAdminLoginTicket(
    {
      ticketId: 'ticket-1',
      githubUserId: '12345678',
      githubLogin: 'jinhwan1030',
      issuedAt: nowSeconds - 5,
      expiresAt: nowSeconds + 60,
      ...overrides,
    },
    TICKET_SECRET,
  );
}

function setupAuth() {
  const database = openDatabase(':memory:');
  migrateDatabase(database);
  let generatedTokenCount = 0;
  const auth = createAdminAuth(database, {
    allowedGithubUserId: '12345678',
    loginTicketSecret: TICKET_SECRET,
    clock: () => NOW,
    idGenerator: () => 'session-1',
    tokenGenerator: () => `token-${++generatedTokenCount}`.padEnd(43, 'x'),
  });
  return { auth, database };
}

test('exchanges a one-time ticket for a revocable session and CSRF token', () => {
  const { auth, database } = setupAuth();
  try {
    const result = auth.exchangeLoginTicket(loginTicket());
    const session = auth.verifySession(result.sessionToken);

    assert.equal(session.githubUserId, '12345678');
    assert.equal(session.githubLogin, 'jinhwan1030');
    assert.doesNotThrow(() => auth.verifyCsrf(session, result.csrfToken));
    assert.throws(
      () => auth.verifyCsrf(session, 'wrong-token'),
      (error) => error instanceof AuthenticationError && error.code === 'invalid_csrf_token',
    );
    assert.throws(
      () => auth.exchangeLoginTicket(loginTicket()),
      (error) => error instanceof AuthenticationError && error.code === 'login_ticket_replayed',
    );

    assert.equal(auth.revoke(result.sessionToken), true);
    assert.equal(auth.prune(), 0);
    assert.throws(
      () => auth.exchangeLoginTicket(loginTicket()),
      (error) => error instanceof AuthenticationError && error.code === 'login_ticket_replayed',
    );
    assert.throws(
      () => auth.verifySession(result.sessionToken),
      (error) => error instanceof AuthenticationError && error.code === 'invalid_session',
    );
  } finally {
    database.close();
  }
});

test('rejects tampered, expired, long-lived, and unauthorized login tickets', () => {
  const { auth, database } = setupAuth();
  try {
    const ticket = loginTicket();
    const tamperedParts = ticket.split('.');
    tamperedParts[2] = `${tamperedParts[2][0] === 'A' ? 'B' : 'A'}${tamperedParts[2].slice(1)}`;
    assert.throws(
      () => verifyAdminLoginTicket(tamperedParts.join('.'), TICKET_SECRET, NOW),
      (error) => error instanceof AuthenticationError && error.code === 'invalid_login_ticket',
    );
    assert.throws(
      () => auth.exchangeLoginTicket(loginTicket({ expiresAt: Math.floor(NOW / 1_000) - 1 })),
      (error) => error instanceof AuthenticationError && error.code === 'expired_login_ticket',
    );
    assert.throws(
      () => auth.exchangeLoginTicket(loginTicket({ expiresAt: Math.floor(NOW / 1_000) + 301 })),
      (error) => error instanceof AuthenticationError && error.code === 'invalid_login_ticket',
    );
    assert.throws(
      () => auth.exchangeLoginTicket(loginTicket({ githubUserId: '99999999' })),
      (error) => error instanceof AuthenticationError && error.code === 'admin_not_allowed',
    );
  } finally {
    database.close();
  }
});

test('serializes a host-only secure administrator cookie', () => {
  const cookie = serializeAdminSessionCookie('session-token', 600);
  assert.match(cookie, new RegExp(`^${ADMIN_SESSION_COOKIE}=session-token;`));
  assert.match(cookie, /Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=600$/);
  assert.doesNotMatch(cookie, /Domain=/);
  assert.match(clearAdminSessionCookie(), /Max-Age=0$/);
});
