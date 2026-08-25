import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeContentRuntime } from '../src/lib/server/content-runtime.js';
import * as healthRoute from '../src/pages/api/health.js';

test('runtime health reports database and writable media readiness without exposing failures', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-runtime-health-'));
  const mediaPath = path.join(directory, 'uploads');
  fs.mkdirSync(mediaPath);
  const previousEnvironment = {
    JHWAN_DATABASE_PATH: process.env.JHWAN_DATABASE_PATH,
    JHWAN_CONTENT_SEED_PATH: process.env.JHWAN_CONTENT_SEED_PATH,
    JHWAN_MEDIA_PATH: process.env.JHWAN_MEDIA_PATH,
  };
  Object.assign(process.env, {
    JHWAN_DATABASE_PATH: path.join(directory, 'content.db'),
    JHWAN_CONTENT_SEED_PATH: path.resolve('src/content/blog'),
    JHWAN_MEDIA_PATH: mediaPath,
  });
  context.after(() => {
    closeContentRuntime();
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const healthy = healthRoute.GET();
  assert.equal(healthy.status, 200);
  assert.equal(healthy.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await healthy.json(), {
    status: 'ok',
    checks: { database: 'ok', mediaStorage: 'ok' },
  });

  const head = healthRoute.HEAD();
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');

  const unsupported = healthRoute.ALL();
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get('allow'), 'GET, HEAD');

  process.env.JHWAN_MEDIA_PATH = path.join(directory, 'missing-uploads');
  const originalError = console.error;
  let logged = '';
  console.error = (message) => { logged += message; };
  try {
    const unavailable = healthRoute.GET();
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { status: 'unavailable' });
  } finally {
    console.error = originalError;
  }
  assert.match(logged, /"event":"runtime_health_failed"/);
  assert.doesNotMatch(logged, /ADMIN_LOGIN_TICKET_SECRET/);
});
