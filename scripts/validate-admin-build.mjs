import fs from 'node:fs';
import path from 'node:path';

const adminRoot = path.resolve('dist/client/admin');
const indexPath = path.join(adminRoot, 'index.html');
const index = fs.readFileSync(indexPath, 'utf8');
const errors = [];
const dockerIgnoreEntries = fs.readFileSync(path.resolve('.dockerignore'), 'utf8')
  .split(/\r?\n/)
  .map((entry) => entry.trim())
  .filter((entry) => entry && !entry.startsWith('#'));

if (!index.includes('jhwan.dev Content Studio')) errors.push('new Content Studio title is missing');
if (!index.includes('https://auth.jhwan.dev/admin/auth')) errors.push('administrator OAuth link is missing');
if (index.includes('sveltia-cms') || fs.existsSync(path.join(adminRoot, 'config.yml'))) {
  errors.push('legacy Sveltia CMS assets remain in the production build');
}
if (dockerIgnoreEntries.some((entry) => /^\/?admin\/?$/.test(entry))) {
  errors.push('the administrator source directory is excluded from the Docker build context');
}
for (const requiredSecretPattern of ['**/.dev.vars', '**/.env']) {
  if (!dockerIgnoreEntries.includes(requiredSecretPattern)) {
    errors.push(`secret files are not excluded from the Docker build context: ${requiredSecretPattern}`);
  }
}
if (!/<script[^>]+src="\.\/assets\/[^"?]+\.js"/.test(index)) {
  errors.push('bundled administrator JavaScript is missing');
}
if (!/<link[^>]+href="\.\/assets\/[^"?]+\.css"/.test(index)) {
  errors.push('bundled administrator stylesheet is missing');
}

for (const match of index.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const reference = match[1];
  if (!reference.startsWith('./')) continue;
  const target = path.resolve(adminRoot, reference.slice(2));
  if (!target.startsWith(`${adminRoot}${path.sep}`) || !fs.existsSync(target)) {
    errors.push(`broken administrator asset: ${reference}`);
  }
}

if (errors.length > 0) throw new Error(`Administrator production build validation failed:\n${errors.join('\n')}`);
console.log('Administrator production build validation passed');
