import { getContentRuntime } from '../lib/server/content-runtime.js';

const STATIC_PATHS = ['/', '/about/', '/blog/'];

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function GET({ site }) {
  const origin = site ?? new URL('https://jhwan.dev');
  const posts = getContentRuntime().repository.listPublished();
  const entries = [
    ...STATIC_PATHS.map((pathname) => ({ location: new URL(pathname, origin).href })),
    ...posts.map((post) => ({
      location: new URL(`/blog/${post.slug}/`, origin).href,
      lastModified: post.contentUpdatedAt ?? post.updatedAt ?? post.publishedAt,
    })),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
    .map(({ location, lastModified }) => `  <url><loc>${escapeXml(location)}</loc>${lastModified ? `<lastmod>${escapeXml(lastModified)}</lastmod>` : ''}</url>`)
    .join('\n')}\n</urlset>\n`;

  return new Response(body, {
    headers: {
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
}
