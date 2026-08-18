import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { parseCmsConfig, validateCmsConfig } from './validate-cms-config.mjs';

const config = parseCmsConfig(
  fs.readFileSync(new URL('../public/admin/config.yml', import.meta.url), 'utf8'),
);
const adminHtml = fs.readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');

function cloneConfig() {
  return structuredClone(config);
}

test('accepts the production CMS configuration', () => {
  assert.doesNotThrow(() => validateCmsConfig(cloneConfig(), adminHtml));
});

test('rejects a missing global media folder', () => {
  const invalid = cloneConfig();
  delete invalid.media_folder;

  assert.throws(() => validateCmsConfig(invalid, adminHtml), /media_folder must be/);
});

test('rejects a relative global public folder', () => {
  const invalid = cloneConfig();
  invalid.public_folder = '../../assets/blog';

  assert.throws(() => validateCmsConfig(invalid, adminHtml), /public_folder must start/);
});

test('rejects an Astro media path mismatch', () => {
  const invalid = cloneConfig();
  invalid.collections[0].media_folder = '../assets/blog';

  assert.throws(() => validateCmsConfig(invalid, adminHtml), /resolves to/);
});

test('rejects unsupported legacy settings', () => {
  const invalid = cloneConfig();
  invalid.local_backend = true;

  assert.throws(() => validateCmsConfig(invalid, adminHtml), /local_backend is not supported/);
});
