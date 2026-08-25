import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve('dist-admin');
const destination = path.resolve('dist/client/admin');
const clientRoot = path.resolve('dist/client');
const sourceAssets = path.join(source, 'assets');
const assetDestination = path.resolve('dist/client/_astro/admin');

for (const target of [destination, assetDestination]) {
  if (!target.startsWith(`${clientRoot}${path.sep}`)) {
    throw new Error(`Refusing to install the administrator build outside the Astro client root: ${target}`);
  }
}

const indexPath = path.join(source, 'index.html');
if (!fs.statSync(indexPath).isFile()) {
  throw new Error(`Administrator build index is missing: ${indexPath}`);
}
const index = fs.readFileSync(indexPath, 'utf8');
if (!index.includes('jhwan.dev Content Studio') || index.includes('sveltia-cms')) {
  throw new Error('Administrator build identity validation failed');
}
if (!fs.statSync(sourceAssets).isDirectory()) {
  throw new Error(`Administrator build assets are missing: ${sourceAssets}`);
}

const installedIndex = index.replaceAll('./assets/', '/_astro/admin/');
if (installedIndex === index) {
  throw new Error('Administrator build did not contain rewritable asset references');
}

fs.rmSync(destination, { recursive: true, force: true });
fs.rmSync(assetDestination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
fs.rmSync(path.join(destination, 'assets'), { recursive: true, force: true });
fs.mkdirSync(assetDestination, { recursive: true });
fs.cpSync(sourceAssets, assetDestination, { recursive: true, errorOnExist: true, force: false });
fs.writeFileSync(path.join(destination, 'index.html'), installedIndex);
console.log(`Administrator build installed: ${destination} (assets: ${assetDestination})`);
