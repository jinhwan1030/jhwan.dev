import path from 'node:path';
import { parseArgs } from 'node:util';

import {
  analyzeLegacyContent,
  importAnalyzedLegacyContent,
} from './lib/legacy-content-migration.mjs';

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    content: { type: 'string', default: 'src/content/blog' },
    database: { type: 'string' },
    media: { type: 'string', default: 'src/assets/blog' },
    uploads: { type: 'string' },
  },
});

if (values.apply && (!values.database || !values.uploads)) {
  throw new Error('Use --apply with both --database <path> and --uploads <path>.');
}

const projectRoot = process.cwd();
const analysis = await analyzeLegacyContent({
  projectRoot,
  contentDirectory: path.resolve(values.content),
  mediaSource: path.resolve(values.media),
});
const result = importAnalyzedLegacyContent(analysis, {
  apply: values.apply,
  databasePath: values.apply ? path.resolve(values.database) : ':memory:',
  mediaDestination: values.apply ? path.resolve(values.uploads) : undefined,
});

console.log(JSON.stringify(result, null, 2));
