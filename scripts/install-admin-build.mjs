import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve('dist-admin');
const destination = path.resolve('dist/client/admin');
const clientRoot = path.resolve('dist/client');

if (!destination.startsWith(`${clientRoot}${path.sep}`)) {
  throw new Error(`Refusing to install the administrator build outside the Astro client root: ${destination}`);
}

const indexPath = path.join(source, 'index.html');
if (!fs.statSync(indexPath).isFile()) {
  throw new Error(`Administrator build index is missing: ${indexPath}`);
}
const index = fs.readFileSync(indexPath, 'utf8');
if (!index.includes('jhwan.dev Content Studio') || index.includes('sveltia-cms')) {
  throw new Error('Administrator build identity validation failed');
}

fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
console.log(`Administrator build installed: ${destination}`);
