import { parseArgs } from 'node:util';
import { openDatabase, verifyDatabase } from '../src/lib/server/database.js';
import { migrateDatabase } from '../src/lib/server/migrations.js';

const { values } = parseArgs({
  options: {
    database: { type: 'string' },
  },
});
const databasePath = values.database ?? process.env.JHWAN_DATABASE_PATH;

if (!databasePath) {
  throw new Error('Refusing to create a database implicitly. Pass --database <path> or JHWAN_DATABASE_PATH.');
}

const database = openDatabase(databasePath);
try {
  const migration = migrateDatabase(database);
  const verification = verifyDatabase(database);
  console.log(
    JSON.stringify(
      {
        database: databasePath,
        currentVersion: migration.currentVersion,
        applied: migration.applied,
        verification,
      },
      null,
      2,
    ),
  );
} finally {
  database.close();
}
