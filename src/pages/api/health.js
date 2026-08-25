import { checkRuntimeHealth } from '../../lib/server/runtime-health.js';

export const prerender = false;

const HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
};

function healthResponse({ includeBody = true } = {}) {
  try {
    const result = checkRuntimeHealth();
    return new Response(includeBody ? JSON.stringify(result) : null, {
      status: 200,
      headers: HEADERS,
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'runtime_health_failed',
      message: error instanceof Error ? error.message : 'Unknown runtime health failure',
    }));
    return new Response(includeBody ? JSON.stringify({ status: 'unavailable' }) : null, {
      status: 503,
      headers: HEADERS,
    });
  }
}

export function GET() {
  return healthResponse();
}

export function HEAD() {
  return healthResponse({ includeBody: false });
}

export function ALL() {
  return new Response(JSON.stringify({ status: 'method_not_allowed' }), {
    status: 405,
    headers: { ...HEADERS, Allow: 'GET, HEAD' },
  });
}
