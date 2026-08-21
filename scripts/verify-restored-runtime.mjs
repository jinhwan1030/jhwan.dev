import { parseArgs } from 'node:util';

import { verifyRestoredRuntime } from './lib/restore-rehearsal.mjs';

const { values } = parseArgs({
  options: {
    origin: { type: 'string' },
    database: { type: 'string' },
    media: { type: 'string' },
  },
});

if (!values.origin || !values.database || !values.media) {
  throw new Error('Use --origin <url> --database <path> --media <path>.');
}

const result = await verifyRestoredRuntime({
  origin: values.origin,
  databasePath: values.database,
  mediaRoot: values.media,
});
console.log(JSON.stringify(result, null, 2));
