import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const exporter = fs.readFileSync(
  path.resolve('deploy/raspberry-pi/export-homepage-backup.sh'),
  'utf8',
);
const enrollment = fs.readFileSync(
  path.resolve('deploy/raspberry-pi/enroll-homepage-offsite-key.sh'),
  'utf8',
);

test('exports only a checksum-verified timestamped backup', () => {
  assert.match(exporter, /SSH_ORIGINAL_COMMAND/);
  assert.match(exporter, /sha256sum --check --strict checksums\.sha256/);
  assert.match(exporter, /tar --create --gzip --directory "\$backup_root_real" --file - "\$stamp"/);
  assert.doesNotMatch(exporter, /rm -rf|docker|sudo/);
});

test('enrolls an ED25519 key with a forced restricted command', () => {
  assert.match(enrollment, /\^ssh-ed25519/);
  assert.match(enrollment, /restrict,command=/);
  assert.match(enrollment, /jhwan-homepage-offsite-export/);
  assert.match(enrollment, /chmod 0600 "\$AUTHORIZED_KEYS"/);
});
