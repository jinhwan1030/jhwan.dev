import { createAdminAuth } from './admin-auth.js';
import { createAdminPostService } from './admin-post-service.js';
import { getContentRuntime } from './content-runtime.js';

const ADMIN_RUNTIME_SYMBOL = Symbol.for('jhwan.admin-runtime');

export function isAdminEnabled() {
  return process.env.JHWAN_ADMIN_ENABLED === 'true';
}

export function createAdminRuntime({
  allowedGithubUserId = process.env.ADMIN_GITHUB_USER_ID,
  loginTicketSecret = process.env.ADMIN_LOGIN_TICKET_SECRET,
  contentRuntime = getContentRuntime(),
} = {}) {
  if (!isAdminEnabled()) throw new Error('Administrator API is disabled');
  const auth = createAdminAuth(contentRuntime.database, {
    allowedGithubUserId,
    loginTicketSecret,
  });
  const service = createAdminPostService({ auth, repository: contentRuntime.repository });
  return { ...contentRuntime, auth, service };
}

export function getAdminRuntime() {
  if (!globalThis[ADMIN_RUNTIME_SYMBOL]) globalThis[ADMIN_RUNTIME_SYMBOL] = createAdminRuntime();
  return globalThis[ADMIN_RUNTIME_SYMBOL];
}

export function closeAdminRuntime() {
  delete globalThis[ADMIN_RUNTIME_SYMBOL];
}
