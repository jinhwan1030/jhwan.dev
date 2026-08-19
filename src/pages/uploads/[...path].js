import { createManagedMediaResponse } from '../../lib/server/media-storage.js';

export const prerender = false;

function serve({ params, request }) {
  return createManagedMediaResponse(params.path ?? '', {
    method: request.method,
    ifNoneMatch: request.headers.get('If-None-Match'),
  });
}

export const GET = serve;
export const HEAD = serve;
