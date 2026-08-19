import { parseArgs } from 'node:util';

import { verifyContentBackup } from './lib/content-backup.mjs';

const { values } = parseArgs({
  options: {
    database: { type: 'string' },
    media: { type: 'string' },
  },
});

if (!values.database || !values.media) {
  throw new Error('Use --database <backup database> and --media <backup media directory>.');
}

console.log(JSON.stringify(verifyContentBackup({
  databasePath: values.database,
  mediaRoot: values.media,
}), null, 2));
