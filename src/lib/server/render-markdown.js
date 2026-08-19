import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'a', 'blockquote', 'br', 'code', 'del', 'em', 'h2', 'h3', 'h4', 'hr', 'img', 'li',
  'ol', 'p', 'pre', 's', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
];

export function renderMarkdown(markdown) {
  const rendered = marked.parse(markdown, { async: false, breaks: true, gfm: true });
  return sanitizeHtml(rendered, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title', 'rel'],
      code: ['class'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      th: ['align'],
      td: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: 'a',
        attribs: {
          ...attributes,
          ...(attributes.href?.startsWith('http') ? { rel: 'noopener noreferrer' } : {}),
        },
      }),
      img: (_tagName, attributes) => ({
        tagName: 'img',
        attribs: { ...attributes, loading: 'lazy' },
      }),
    },
  });
}
