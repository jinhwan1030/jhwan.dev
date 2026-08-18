import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outputDirectory = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const siteOrigin = 'https://jhwan.dev';

function collectFiles(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(entryPath, extension);
    return entry.name.endsWith(extension) ? [entryPath] : [];
  });
}

function resolveOutputPath(urlPath) {
  const pathname = decodeURIComponent(urlPath.split(/[?#]/, 1)[0]);
  const relativePath = pathname.replace(/^\/+/, '');
  if (!relativePath) return path.join(outputDirectory, 'index.html');

  const directPath = path.resolve(outputDirectory, relativePath);
  if (!directPath.startsWith(`${outputDirectory}${path.sep}`)) return null;
  const indexPath = path.join(directPath, 'index.html');
  if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) return directPath;
  if (fs.existsSync(indexPath)) return indexPath;
  return null;
}

const htmlFiles = collectFiles(outputDirectory, '.html');
const errors = [];
let internalReferenceCount = 0;

for (const htmlFile of htmlFiles) {
  const source = fs.readFileSync(htmlFile, 'utf8');
  const page = `/${path.relative(outputDirectory, htmlFile).replace(/\\/g, '/')}`;
  const references = source.matchAll(/(?:href|src)=["']([^"']+)["']/g);

  for (const match of references) {
    const reference = match[1];
    if (!reference.startsWith('/') || reference.startsWith('//')) continue;
    internalReferenceCount += 1;

    try {
      if (!resolveOutputPath(reference)) errors.push(`${page}: missing ${reference}`);
    } catch {
      errors.push(`${page}: invalid URL encoding in ${reference}`);
    }
  }
}

const blogDirectory = path.join(outputDirectory, 'blog');
const blogPages = collectFiles(blogDirectory, '.html').filter(
  (file) => file !== path.join(blogDirectory, 'index.html'),
);

for (const blogPage of blogPages) {
  const source = fs.readFileSync(blogPage, 'utf8');
  const slug = path.relative(blogDirectory, path.dirname(blogPage)).replace(/\\/g, '/');
  const canonicalURL = `${siteOrigin}/blog/${slug}/`;
  const requiredMetadata = [
    '<meta property="og:type" content="article">',
    '<meta property="article:published_time"',
    `<link rel="canonical" href="${canonicalURL}">`,
    `<meta property="og:url" content="${canonicalURL}">`,
  ];

  for (const metadata of requiredMetadata) {
    if (!source.includes(metadata)) errors.push(`/blog/${slug}/: missing metadata ${metadata}`);
  }
}

if (errors.length > 0) {
  throw new Error(`Site output validation failed:\n${errors.join('\n')}`);
}

console.log(
  `Site output validation passed (${htmlFiles.length} HTML files, ${internalReferenceCount} internal references, ${blogPages.length} article pages)`,
);
