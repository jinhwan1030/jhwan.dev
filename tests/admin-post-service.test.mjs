import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminAuth, signAdminLoginTicket } from '../src/lib/server/admin-auth.js';
import {
  AdminApiError,
  createAdminPostService,
} from '../src/lib/server/admin-post-service.js';
import { openDatabase, verifyDatabase } from '../src/lib/server/database.js';
import { migrateDatabase } from '../src/lib/server/migrations.js';
import { createPostRepository } from '../src/lib/server/post-repository.js';

const TICKET_SECRET = 'another-ticket-secret-with-more-than-32-bytes';
const NOW = Date.parse('2026-08-19T06:00:00.000Z');

function expectApiError(operation, status, code) {
  assert.throws(
    operation,
    (error) => error instanceof AdminApiError && error.status === status && error.code === code,
  );
}

function setupService() {
  const database = openDatabase(':memory:');
  migrateDatabase(database);
  const authTokens = ['s'.repeat(43), 'c'.repeat(43)];
  const auth = createAdminAuth(database, {
    allowedGithubUserId: '12345678',
    loginTicketSecret: TICKET_SECRET,
    clock: () => NOW,
    idGenerator: () => 'session-1',
    tokenGenerator: () => authTokens.shift(),
  });
  const nowSeconds = Math.floor(NOW / 1_000);
  const ticket = signAdminLoginTicket(
    {
      ticketId: 'api-ticket-1',
      githubUserId: '12345678',
      githubLogin: 'jinhwan1030',
      issuedAt: nowSeconds - 1,
      expiresAt: nowSeconds + 60,
    },
    TICKET_SECRET,
  );
  const credentials = auth.exchangeLoginTicket(ticket);
  const repository = createPostRepository(database, {
    idGenerator: () => 'post-1',
    clock: () => NOW,
  });
  const service = createAdminPostService({ auth, repository });
  const readContext = { sessionToken: credentials.sessionToken };
  const writeContext = { ...readContext, csrfToken: credentials.csrfToken };
  return { auth, credentials, database, readContext, repository, service, writeContext };
}

test('requires an administrator session and CSRF token for writes', () => {
  const { database, readContext, service } = setupService();
  try {
    expectApiError(() => service.listPosts({}), 401, 'session_required');
    expectApiError(
      () => service.createPost(readContext, {
        slug: 'missing-csrf',
        title: 'Missing CSRF',
        description: 'This request must not be accepted.',
        bodyMarkdown: '',
      }),
      403,
      'invalid_csrf_token',
    );
    assert.equal(service.listPosts(readContext).length, 0);
  } finally {
    database.close();
  }
});

test('creates, publishes, renames, deletes, and restores with optimistic locking', () => {
  const { database, repository, service, writeContext } = setupService();
  try {
    const created = service.createPost(writeContext, {
      slug: '새-게시글',
      title: '새 게시글',
      description: '관리자 API 생성 테스트',
      bodyMarkdown: '초안 본문입니다.',
    });
    assert.equal(created.status, 'draft');
    assert.equal(created.version, 1);
    assert.equal(created.sourcePath, null);

    const published = service.updatePost(writeContext, created.id, {
      expectedVersion: 1,
      status: 'published',
      bodyMarkdown: '공개 본문입니다.',
    });
    assert.equal(published.status, 'published');
    assert.equal(published.version, 2);
    assert.equal(published.publishedAt, new Date(NOW).toISOString());

    expectApiError(
      () => service.updatePost(writeContext, created.id, { expectedVersion: 1, title: '충돌' }),
      409,
      'version_conflict',
    );

    const renamed = service.updatePost(writeContext, created.id, {
      expectedVersion: 2,
      slug: 'renamed-post',
    });
    assert.equal(renamed.version, 3);
    assert.equal(repository.resolveHistoricalSlug('새-게시글').id, created.id);
    expectApiError(
      () => service.createPost(writeContext, {
        slug: '새-게시글',
        title: '중복 slug',
        description: '과거 주소도 다시 사용할 수 없습니다.',
        bodyMarkdown: '',
      }),
      409,
      'slug_conflict',
    );

    const deleted = service.deletePost(writeContext, created.id, { expectedVersion: 3 });
    assert.equal(deleted.version, 4);
    assert.ok(deleted.deletedAt);
    assert.equal(service.listPosts(writeContext).length, 0);
    assert.equal(service.listPosts(writeContext, { includeDeleted: true }).length, 1);

    const restored = service.restorePost(writeContext, created.id, { expectedVersion: 4 });
    assert.equal(restored.version, 5);
    assert.equal(restored.deletedAt, null);
    assert.equal(service.listRevisions(writeContext, created.id).length, 5);
    assert.deepEqual(verifyDatabase(database), { integrity: 'ok', foreignKeyViolations: 0 });
  } finally {
    database.close();
  }
});

test('rejects malformed and unknown post fields', () => {
  const { database, service, writeContext } = setupService();
  try {
    expectApiError(
      () => service.createPost(writeContext, {
        slug: '../escape',
        title: '',
        description: 'Invalid post',
        bodyMarkdown: '',
        unexpected: true,
      }),
      400,
      'invalid_request',
    );
  } finally {
    database.close();
  }
});
