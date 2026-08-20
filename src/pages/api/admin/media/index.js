import { AdminApiError } from '../../../../lib/server/admin-post-service.js';
import {
  adminContext,
  errorResponse,
  json,
  requireAdminEnabled,
} from '../../../../lib/server/admin-http.js';
import { getAdminRuntime } from '../../../../lib/server/admin-runtime.js';
import { MAX_MEDIA_BYTES, storeManagedMedia } from '../../../../lib/server/media-storage.js';

const MAX_MULTIPART_BYTES = MAX_MEDIA_BYTES + 1_048_576;

async function readMultipartForm(request) {
  if (!request.body) throw new AdminApiError(400, 'missing_media', '업로드할 이미지가 없습니다.');
  const chunks = [];
  let byteLength = 0;
  const reader = request.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_MULTIPART_BYTES) {
        await reader.cancel();
        throw new AdminApiError(413, 'request_too_large', '업로드 요청이 너무 큽니다.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const boundedRequest = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), byteLength),
  });
  try {
    return await boundedRequest.formData();
  } catch {
    throw new AdminApiError(400, 'invalid_multipart', '이미지 업로드 요청을 읽지 못했습니다.');
  }
}

export async function POST({ request }) {
  const disabled = requireAdminEnabled();
  if (disabled) return disabled;

  try {
    const runtime = getAdminRuntime();
    const context = adminContext(request);
    const session = runtime.auth.verifySession(context.sessionToken);
    runtime.auth.verifyCsrf(session, context.csrfToken);

    const contentType = request.headers.get('Content-Type') ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
      throw new AdminApiError(415, 'invalid_content_type', 'multipart 이미지 요청만 지원합니다.');
    }
    const contentLength = Number(request.headers.get('Content-Length') ?? 0);
    if (contentLength > MAX_MULTIPART_BYTES) {
      throw new AdminApiError(413, 'request_too_large', '업로드 요청이 너무 큽니다.');
    }

    const form = await readMultipartForm(request);
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function' || typeof file.name !== 'string') {
      throw new AdminApiError(400, 'missing_media', '업로드할 이미지가 없습니다.');
    }
    if (file.size > MAX_MEDIA_BYTES) {
      throw new AdminApiError(413, 'media_too_large', '이미지는 25 MiB 이하여야 합니다.');
    }

    const media = await storeManagedMedia(runtime.database, {
      contents: Buffer.from(await file.arrayBuffer()),
      originalName: file.name,
      declaredMimeType: file.type,
      altText: form.get('altText') ?? '',
    });
    return json({ media }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
