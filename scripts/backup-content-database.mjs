import { parseArgs } from 'node:util';

import { backupContentDatabase } from './lib/content-backup.mjs';

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    destination: { type: 'string' },
  },
});

if (!values.source || !values.destination) {
  throw new Error('Use --source <database> and --destination <new backup database>.');
}

console.log(JSON.stringify(await backupContentDatabase({
  source: values.source,
  destination: values.destination,
}), null, 2));
