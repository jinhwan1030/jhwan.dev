import { parseArgs } from 'node:util';

import { invalidateAdminSessions } from './lib/content-backup.mjs';

const { values } = parseArgs({
  options: {
    database: { type: 'string' },
  },
});

if (!values.database) throw new Error('Use --database <restored database>.');
console.log(JSON.stringify(invalidateAdminSessions({ databasePath: values.database }), null, 2));
