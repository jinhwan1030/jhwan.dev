export class AdminHttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AdminHttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function readCookie(name) {
  const prefix = `${name}=`;
  const value = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : null;
}

async function parseResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new AdminHttpError(response.status, 'invalid_response', '서버 응답을 읽지 못했습니다.');
  }
  if (!response.ok) {
    throw new AdminHttpError(
      response.status,
      payload?.error?.code ?? 'request_failed',
      payload?.error?.message ?? '요청을 처리하지 못했습니다.',
      payload?.error?.details,
    );
  }
  return payload;
}

export function createHttpAdminApi({ baseUrl = '/api/admin' } = {}) {
  async function request(path, { method = 'GET', body, csrf = false } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrf) {
      const token = readCookie('__Host-jhwan_admin_csrf');
      if (!token) throw new AdminHttpError(403, 'invalid_csrf_token', '보안 토큰이 없습니다. 다시 로그인해주세요.');
      headers['X-CSRF-Token'] = token;
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return parseResponse(response);
  }

  return {
    async exchangeLoginTicketFromHash() {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const ticket = params.get('ticket');
      if (!ticket) return null;
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      return (await request('/session', { method: 'POST', body: { ticket } })).session;
    },

    async getSession() {
      return (await request('/session')).session;
    },

    async logout() {
      return request('/session', { method: 'DELETE', csrf: true });
    },

    async listPosts({ includeDeleted = true } = {}) {
      return (await request(`/posts?includeDeleted=${includeDeleted}`)).posts;
    },

    async getPost(id) {
      return (await request(`/posts/${encodeURIComponent(id)}`)).post;
    },

    async createPost(input) {
      return (await request('/posts', { method: 'POST', body: input, csrf: true })).post;
    },

    async updatePost(id, input) {
      return (await request(`/posts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: input,
        csrf: true,
      })).post;
    },

    async deletePost(id, input) {
      return (await request(`/posts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: input,
        csrf: true,
      })).post;
    },

    async restorePost(id, input) {
      return (await request(`/posts/${encodeURIComponent(id)}/restore`, {
        method: 'POST',
        body: input,
        csrf: true,
      })).post;
    },

    async listRevisions(id) {
      return (await request(`/posts/${encodeURIComponent(id)}/revisions`)).revisions;
    },
  };
}
