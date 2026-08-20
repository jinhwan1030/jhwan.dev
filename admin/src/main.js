import { createDemoAdminApi } from './demo-api.js';
import { createHttpAdminApi } from './http-api.js';
import {
  createMarkdownEditor,
  insertEditorImage,
  isCommandActive,
  runEditorCommand,
  setMarkdown,
} from './editor.js';

const demoMode = new URLSearchParams(window.location.search).get('demo') === '1';
const api = demoMode ? createDemoAdminApi() : createHttpAdminApi();
const elements = {
  body: document.body,
  sidebar: document.querySelector('#post-sidebar'),
  sidebarToggle: document.querySelector('#sidebar-toggle'),
  sidebarScrim: document.querySelector('#sidebar-scrim'),
  settingsToggle: document.querySelector('#settings-toggle'),
  settingsClose: document.querySelector('#settings-close'),
  postList: document.querySelector('#post-list'),
  postCount: document.querySelector('#post-count'),
  search: document.querySelector('#post-search'),
  filters: document.querySelector('#status-filters'),
  refresh: document.querySelector('#refresh-posts'),
  newPost: document.querySelector('#new-post'),
  saveButton: document.querySelector('#save-post'),
  saveIndicator: document.querySelector('#save-indicator'),
  saveLabel: document.querySelector('#save-label'),
  title: document.querySelector('#post-title'),
  slug: document.querySelector('#post-slug'),
  description: document.querySelector('#post-description'),
  descriptionCount: document.querySelector('#description-count'),
  category: document.querySelector('#post-category'),
  publishedAt: document.querySelector('#published-at'),
  statusInputs: [...document.querySelectorAll('input[name="status"]')],
  stateLabel: document.querySelector('#document-state-label'),
  lastUpdated: document.querySelector('#last-updated'),
  wordCount: document.querySelector('#word-count'),
  versionLabel: document.querySelector('#version-label'),
  modeTabs: [...document.querySelectorAll('[data-mode]')],
  visualPane: document.querySelector('#visual-pane'),
  markdownPane: document.querySelector('#markdown-pane'),
  previewPane: document.querySelector('#preview-pane'),
  markdownSource: document.querySelector('#markdown-source'),
  preview: document.querySelector('#article-preview'),
  previewUrl: document.querySelector('#preview-url'),
  toolbar: document.querySelector('#format-toolbar'),
  editorElement: document.querySelector('#rich-editor'),
  deleteButton: document.querySelector('#delete-post'),
  restoreButton: document.querySelector('#restore-post'),
  historyOpen: document.querySelector('#open-history'),
  historyDialog: document.querySelector('#history-dialog'),
  historyClose: document.querySelector('#history-close'),
  historyList: document.querySelector('#history-list'),
  toast: document.querySelector('#toast'),
  authScreen: document.querySelector('#auth-screen'),
  authMessage: document.querySelector('#auth-message'),
  environmentBadge: document.querySelector('#environment-badge'),
  adminAccount: document.querySelector('#admin-account'),
  logout: document.querySelector('#logout'),
  insertImage: document.querySelector('#insert-image'),
  uploadImage: document.querySelector('#upload-image'),
  imageFile: document.querySelector('#image-file'),
  heroPreview: document.querySelector('#hero-preview'),
  heroPreviewImage: document.querySelector('#hero-preview-image'),
  heroPreviewPath: document.querySelector('#hero-preview-path'),
  removeHeroImage: document.querySelector('#remove-hero-image'),
};

const state = {
  posts: [],
  current: null,
  dirty: false,
  saving: false,
  mode: 'visual',
  filter: 'all',
  query: '',
  slugTouched: false,
  loadingDocument: false,
  recoveryTimer: null,
  uploadTarget: 'hero',
};

const editor = createMarkdownEditor({
  element: elements.editorElement,
  onChange: (markdown) => {
    if (state.loadingDocument) return;
    elements.markdownSource.value = markdown;
    markDirty();
    updateWordCount(markdown);
  },
});

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value, { withTime = false } = {}) {
  if (!value) return '날짜 없음';
  const date = new Date(value);
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

function toLocalDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function slugify(value) {
  return value
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

function statusOf(post) {
  if (post.deletedAt) return 'deleted';
  return post.status;
}

function statusLabel(post) {
  if (post.deletedAt) return '휴지통';
  return post.status === 'published' ? '공개' : '초안';
}

function setSaveState(kind, label) {
  elements.saveIndicator.classList.remove('is-dirty', 'is-saving', 'is-error');
  if (kind !== 'saved') elements.saveIndicator.classList.add(`is-${kind}`);
  elements.saveLabel.textContent = label;
}

function showToast(message, { error = false } = {}) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle('is-error', error);
  elements.toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3_200);
}

function showLogin(error) {
  elements.authMessage.textContent = error?.code === 'admin_disabled'
    ? '영구 저장소 설정이 끝난 뒤 관리자 기능이 활성화됩니다.'
    : (error?.message || 'GitHub 계정으로 본인 확인 후 글을 관리할 수 있습니다.');
  elements.authScreen.hidden = false;
}

function recoveryKey() {
  return `jhwan-admin-recovery:${state.current?.id ?? state.current?.slug ?? 'new'}`;
}

function readLocalRecovery(post) {
  try {
    const key = `jhwan-admin-recovery:${post?.id ?? post?.slug ?? 'new'}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const recovery = JSON.parse(raw);
    if (!recovery?.savedAt || !recovery?.input) return null;
    const serverTimestamp = post?.updatedAt ? Date.parse(post.updatedAt) : 0;
    if (Date.parse(recovery.savedAt) <= serverTimestamp) {
      localStorage.removeItem(key);
      return null;
    }
    if (!window.confirm('브라우저에 서버보다 새로운 임시 저장본이 있습니다. 복구할까요?')) {
      localStorage.removeItem(key);
      return null;
    }
    return recovery.input;
  } catch {
    return null;
  }
}

function scheduleLocalRecovery() {
  window.clearTimeout(state.recoveryTimer);
  state.recoveryTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(
        recoveryKey(),
        JSON.stringify({ savedAt: new Date().toISOString(), input: collectInput({ validate: false }) }),
      );
      if (state.dirty && !state.saving) setSaveState('dirty', '브라우저에 임시 저장됨');
    } catch {
      setSaveState('dirty', '저장되지 않은 변경사항');
    }
  }, 800);
}

function markDirty() {
  if (state.loadingDocument) return;
  state.dirty = true;
  setSaveState('dirty', '저장되지 않은 변경사항');
  scheduleLocalRecovery();
  updatePreview();
}

function updateWordCount(markdown = currentMarkdown()) {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`|\[\]()~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  elements.wordCount.textContent = `${text.length.toLocaleString('ko-KR')}자`;
}

function currentMarkdown() {
  return state.mode === 'markdown' ? elements.markdownSource.value : editor.getMarkdown();
}

function collectInput({ validate = true } = {}) {
  const title = elements.title.value.trim();
  const slug = elements.slug.value.trim().normalize('NFC');
  const description = elements.description.value.trim();
  const status = elements.statusInputs.find((input) => input.checked)?.value ?? 'draft';
  const publishedAt = elements.publishedAt.value
    ? new Date(elements.publishedAt.value).toISOString()
    : null;

  if (validate) {
    const invalid = [
      [!title, elements.title, '제목을 입력해주세요.'],
      [!slug, elements.slug, '글 주소를 입력해주세요.'],
      [!description, elements.description, '목록 설명을 입력해주세요.'],
    ].find(([condition]) => condition);
    if (invalid) {
      invalid[1].focus();
      throw new Error(invalid[2]);
    }
  }

  return {
    title,
    slug,
    description,
    bodyMarkdown: currentMarkdown(),
    category: elements.category.value,
    status,
    heroImagePath: state.current?.heroImagePath ?? null,
    publishedAt,
  };
}

function updatePreview() {
  const title = elements.title.value.trim() || '제목 없는 글';
  const description = elements.description.value.trim();
  elements.previewUrl.textContent = `jhwan.dev/blog/${elements.slug.value.trim()}/`;
  elements.preview.innerHTML = `
    <h1 class="preview-title">${escapeHtml(title)}</h1>
    ${description ? `<p class="preview-description">${escapeHtml(description)}</p>` : ''}
    ${editor.getHTML()}
  `;
}

function filteredPosts() {
  const query = state.query.toLocaleLowerCase('ko-KR');
  return state.posts.filter((post) => {
    const status = statusOf(post);
    if (state.filter !== 'all' && status !== state.filter) return false;
    if (!query) return true;
    return `${post.title} ${post.slug}`.toLocaleLowerCase('ko-KR').includes(query);
  });
}

function renderPostList() {
  const posts = filteredPosts();
  elements.postCount.textContent = `${posts.length}개`;
  if (posts.length === 0) {
    elements.postList.innerHTML = '<div class="list-empty">조건에 맞는 글이 없습니다.<br />검색어나 필터를 바꿔보세요.</div>';
    return;
  }

  elements.postList.innerHTML = posts
    .map((post) => {
      const status = statusOf(post);
      return `
        <button class="post-card ${post.id === state.current?.id ? 'is-active' : ''}" type="button" data-post-id="${escapeHtml(post.id)}">
          <span class="post-card-top">
            <span class="status-pill ${status}">${statusLabel(post)}</span>
            <span class="post-card-category">${escapeHtml(post.category)}</span>
          </span>
          <h2>${escapeHtml(post.title || '제목 없는 글')}</h2>
          <span class="post-card-meta">
            <span>${formatDate(post.updatedAt)}</span>
            <span>v${post.version}</span>
          </span>
        </button>
      `;
    })
    .join('');
}

function updateDocumentMeta() {
  const post = state.current;
  const status = post ? statusLabel(post) : '새 초안';
  elements.stateLabel.textContent = status;
  elements.lastUpdated.textContent = post?.updatedAt
    ? `마지막 저장 ${formatDate(post.updatedAt, { withTime: true })}`
    : '아직 저장되지 않음';
  elements.versionLabel.textContent = post?.version ? `버전 ${post.version}` : '새 글';
  elements.deleteButton.hidden = !post?.id || Boolean(post?.deletedAt);
  elements.restoreButton.hidden = !post?.deletedAt;
}

function updateHeroImage() {
  const source = state.current?.heroImagePath ?? null;
  elements.heroPreview.hidden = !source;
  elements.uploadImage.querySelector('strong').textContent = source ? '대표 이미지 교체' : '이미지 업로드';
  if (!source) {
    elements.heroPreviewImage.removeAttribute('src');
    elements.heroPreviewPath.textContent = '';
    return;
  }
  elements.heroPreviewImage.src = source;
  elements.heroPreviewPath.textContent = source;
}

function populateDocument(post) {
  state.loadingDocument = true;
  state.current = post ? structuredClone(post) : null;
  const recoveredInput = readLocalRecovery(post);
  const document = recoveredInput ? { ...post, ...recoveredInput } : post;
  state.slugTouched = Boolean(post?.id);
  elements.title.value = document?.title ?? '';
  elements.slug.value = document?.slug ?? '';
  elements.description.value = document?.description ?? '';
  elements.descriptionCount.textContent = String(elements.description.value.length);
  elements.category.value = document?.category ?? '개발';
  elements.publishedAt.value = toLocalDateTime(document?.publishedAt);
  for (const input of elements.statusInputs) input.checked = input.value === (document?.status ?? 'draft');

  const markdown = document?.bodyMarkdown ?? '';
  setMarkdown(editor, markdown, false);
  elements.markdownSource.value = markdown;
  updateWordCount(markdown);
  updateDocumentMeta();
  updateHeroImage();
  updatePreview();
  state.dirty = Boolean(recoveredInput);
  setSaveState(
    recoveredInput ? 'dirty' : 'saved',
    recoveredInput ? '임시 저장본 복구됨' : (post?.id ? '저장됨' : '새 글 작성 중'),
  );
  state.loadingDocument = false;
  renderPostList();
  if (recoveredInput) showToast('브라우저의 임시 저장본을 복구했습니다. 확인 후 저장해주세요.');
}

async function loadPosts({ preserveSelection = true } = {}) {
  try {
    state.posts = await api.listPosts({ includeDeleted: true });
    renderPostList();
    if (preserveSelection && state.current?.id) {
      const refreshed = state.posts.find((post) => post.id === state.current.id);
      if (refreshed) populateDocument(refreshed);
    }
  } catch (error) {
    if (error.status === 401 || error.code === 'admin_disabled') showLogin(error);
    showToast(error.message || '글 목록을 불러오지 못했습니다.', { error: true });
  }
}

function confirmDiscard() {
  return !state.dirty || window.confirm('저장하지 않은 변경사항이 있습니다. 이동할까요?');
}

async function selectPost(id) {
  if (id === state.current?.id) return;
  if (!confirmDiscard()) return;
  try {
    const post = await api.getPost(id);
    populateDocument(post);
    elements.body.classList.remove('sidebar-open');
  } catch (error) {
    showToast(error.message || '글을 불러오지 못했습니다.', { error: true });
  }
}

function startNewPost() {
  if (!confirmDiscard()) return;
  populateDocument({
    id: null,
    slug: '',
    title: '',
    description: '',
    bodyMarkdown: '',
    category: '개발',
    status: 'draft',
    heroImagePath: null,
    publishedAt: null,
    updatedAt: null,
    deletedAt: null,
    version: 0,
  });
  state.slugTouched = false;
  elements.title.focus();
  elements.body.classList.remove('sidebar-open');
}

function readableError(error) {
  const messages = {
    version_conflict: '다른 화면에서 먼저 저장했습니다. 목록을 새로고침한 뒤 변경사항을 다시 확인해주세요.',
    slug_conflict: '이미 사용했거나 이전 주소로 보관 중인 글 주소입니다.',
    invalid_request: '입력값을 확인해주세요.',
    media_too_large: '이미지는 25 MiB 이하여야 합니다.',
    invalid_media: '정상적인 이미지 파일인지 확인해주세요.',
    unsupported_media: 'JPEG, PNG, WebP, GIF, AVIF 이미지만 지원합니다.',
    media_type_mismatch: '파일 확장자와 실제 이미지 형식이 일치하지 않습니다.',
  };
  return messages[error.code] ?? error.message ?? '요청을 처리하지 못했습니다.';
}

function beginImageUpload(target) {
  state.uploadTarget = target;
  elements.imageFile.value = '';
  elements.imageFile.click();
}

function markdownImageAlt(value) {
  return value.replace(/[\[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim() || '이미지';
}

async function uploadSelectedImage() {
  const [file] = elements.imageFile.files;
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) {
    showToast('이미지는 25 MiB 이하여야 합니다.', { error: true });
    return;
  }

  const target = state.uploadTarget;
  const altText = markdownImageAlt(elements.title.value || file.name.replace(/\.[^.]+$/, ''));
  elements.uploadImage.disabled = true;
  elements.insertImage.disabled = true;
  showToast('이미지를 업로드하는 중입니다.');
  try {
    const media = await api.uploadMedia(file, { altText });
    if (target === 'hero') {
      state.current = { ...state.current, heroImagePath: media.url };
      updateHeroImage();
      markDirty();
      showToast(media.deduplicated ? '기존 이미지를 대표 이미지로 연결했습니다.' : '대표 이미지를 업로드했습니다.');
      return;
    }

    if (state.mode === 'markdown') {
      const markdown = `![${altText}](${media.url})`;
      elements.markdownSource.setRangeText(
        markdown,
        elements.markdownSource.selectionStart,
        elements.markdownSource.selectionEnd,
        'end',
      );
      markDirty();
    } else {
      if (state.mode === 'preview') switchMode('visual');
      insertEditorImage(editor, { src: media.url, alt: altText });
    }
    showToast(media.deduplicated ? '기존 이미지를 본문에 삽입했습니다.' : '이미지를 업로드해 본문에 삽입했습니다.');
  } catch (error) {
    showToast(readableError(error), { error: true });
  } finally {
    elements.uploadImage.disabled = false;
    elements.insertImage.disabled = false;
  }
}

async function savePost() {
  if (state.saving) return;
  try {
    if (state.mode === 'markdown') setMarkdown(editor, elements.markdownSource.value, false);
    const input = collectInput();
    const isPublishing = state.current?.status !== 'published' && input.status === 'published';
    if (isPublishing && !window.confirm('이 글을 공개할까요? 저장 즉시 사이트에 표시됩니다.')) return;

    state.saving = true;
    elements.saveButton.disabled = true;
    setSaveState('saving', '저장하는 중');
    const saved = state.current?.id
      ? await api.updatePost(state.current.id, { expectedVersion: state.current.version, ...input })
      : await api.createPost(input);

    try { localStorage.removeItem(recoveryKey()); } catch { /* storage may be unavailable */ }
    await loadPosts({ preserveSelection: false });
    populateDocument(saved);
    showToast(saved.status === 'published' ? '글을 저장하고 공개했습니다.' : '초안을 저장했습니다.');
  } catch (error) {
    setSaveState('error', '저장 실패');
    showToast(readableError(error), { error: true });
  } finally {
    state.saving = false;
    elements.saveButton.disabled = false;
  }
}

async function deletePost() {
  if (!state.current?.id || !window.confirm('이 글을 휴지통으로 이동할까요? 나중에 복구할 수 있습니다.')) return;
  try {
    const deleted = await api.deletePost(state.current.id, { expectedVersion: state.current.version });
    await loadPosts({ preserveSelection: false });
    populateDocument(deleted);
    showToast('글을 휴지통으로 이동했습니다.');
  } catch (error) {
    showToast(readableError(error), { error: true });
  }
}

async function restorePost() {
  if (!state.current?.id) return;
  try {
    const restored = await api.restorePost(state.current.id, { expectedVersion: state.current.version });
    await loadPosts({ preserveSelection: false });
    populateDocument(restored);
    showToast('글을 복구했습니다.');
  } catch (error) {
    showToast(readableError(error), { error: true });
  }
}

function switchMode(nextMode) {
  if (nextMode === state.mode) return;
  if (state.mode === 'markdown') {
    state.loadingDocument = true;
    setMarkdown(editor, elements.markdownSource.value, false);
    state.loadingDocument = false;
  }
  if (nextMode === 'markdown') elements.markdownSource.value = editor.getMarkdown();

  state.mode = nextMode;
  elements.visualPane.hidden = nextMode !== 'visual';
  elements.markdownPane.hidden = nextMode !== 'markdown';
  elements.previewPane.hidden = nextMode !== 'preview';
  for (const tab of elements.modeTabs) {
    const active = tab.dataset.mode === nextMode;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  if (nextMode === 'preview') updatePreview();
}

async function openHistory() {
  if (!state.current?.id) {
    showToast('먼저 글을 저장해주세요.');
    return;
  }
  elements.historyList.innerHTML = '<div class="list-empty">수정 이력을 불러오는 중입니다.</div>';
  elements.historyDialog.showModal();
  try {
    const revisions = await api.listRevisions(state.current.id);
    elements.historyList.innerHTML = revisions
      .map((revision) => `
        <div class="history-item">
          <span class="history-version">v${revision.version}</span>
          <span>
            <strong>${escapeHtml(revision.snapshot.title || '제목 없는 글')}</strong>
            <small>${revision.snapshot.status === 'published' ? '공개' : '초안'} · ${escapeHtml(revision.snapshot.slug)}</small>
          </span>
          <time>${formatDate(revision.createdAt, { withTime: true })}</time>
        </div>
      `)
      .join('');
  } catch (error) {
    elements.historyList.innerHTML = `<div class="list-empty">${escapeHtml(readableError(error))}</div>`;
  }
}

function updateToolbarState() {
  for (const button of elements.toolbar.querySelectorAll('[data-command]')) {
    const active = isCommandActive(editor, button.dataset.command);
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

elements.postList.addEventListener('click', (event) => {
  const card = event.target.closest('[data-post-id]');
  if (card) selectPost(card.dataset.postId);
});
elements.search.addEventListener('input', () => {
  state.query = elements.search.value.trim();
  renderPostList();
});
elements.filters.addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  state.filter = button.dataset.filter;
  for (const tab of elements.filters.querySelectorAll('[data-filter]')) {
    const active = tab === button;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  renderPostList();
});
elements.refresh.addEventListener('click', () => loadPosts());
elements.newPost.addEventListener('click', startNewPost);
elements.saveButton.addEventListener('click', savePost);
elements.deleteButton.addEventListener('click', deletePost);
elements.restoreButton.addEventListener('click', restorePost);
elements.uploadImage.addEventListener('click', () => beginImageUpload('hero'));
elements.insertImage.addEventListener('click', () => beginImageUpload('body'));
elements.imageFile.addEventListener('change', uploadSelectedImage);
elements.removeHeroImage.addEventListener('click', () => {
  state.current = { ...state.current, heroImagePath: null };
  updateHeroImage();
  markDirty();
});
elements.historyOpen.addEventListener('click', openHistory);
elements.historyClose.addEventListener('click', () => elements.historyDialog.close());
elements.logout.addEventListener('click', async () => {
  try { await api.logout(); } catch { /* the server may have already expired the session */ }
  elements.adminAccount.textContent = '';
  showLogin();
});
elements.sidebarToggle.addEventListener('click', () => elements.body.classList.toggle('sidebar-open'));
elements.sidebarScrim.addEventListener('click', () => elements.body.classList.remove('sidebar-open'));
elements.settingsToggle.addEventListener('click', () => elements.body.classList.add('settings-open'));
elements.settingsClose.addEventListener('click', () => elements.body.classList.remove('settings-open'));

for (const tab of elements.modeTabs) tab.addEventListener('click', () => switchMode(tab.dataset.mode));

elements.toolbar.addEventListener('click', (event) => {
  const button = event.target.closest('[data-command]');
  if (!button) return;
  let value;
  if (button.dataset.command === 'link') {
    value = window.prompt('연결할 주소를 입력하세요.', 'https://');
    if (!value) return;
  }
  runEditorCommand(editor, button.dataset.command, value);
  updateToolbarState();
});
elements.editorElement.addEventListener('editor-selection-change', updateToolbarState);

elements.title.addEventListener('input', () => {
  if (!state.slugTouched) elements.slug.value = slugify(elements.title.value);
  markDirty();
});
elements.slug.addEventListener('input', () => {
  state.slugTouched = true;
  markDirty();
});
elements.description.addEventListener('input', () => {
  elements.descriptionCount.textContent = String(elements.description.value.length);
  markDirty();
});
elements.category.addEventListener('change', markDirty);
elements.publishedAt.addEventListener('change', markDirty);
for (const input of elements.statusInputs) input.addEventListener('change', markDirty);
elements.markdownSource.addEventListener('input', () => {
  markDirty();
  updateWordCount(elements.markdownSource.value);
});

window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    savePost();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

async function initialize() {
  if (demoMode) {
    elements.environmentBadge.textContent = '데모 데이터';
    elements.logout.hidden = true;
  } else {
    try {
      await api.exchangeLoginTicketFromHash();
      const session = await api.getSession();
      elements.adminAccount.textContent = `@${session.githubLogin}`;
      elements.authScreen.hidden = true;
    } catch (error) {
      showLogin(error);
      return;
    }
  }
  await loadPosts({ preserveSelection: false });
  const firstActive = state.posts.find((post) => !post.deletedAt) ?? state.posts[0];
  if (firstActive) populateDocument(firstActive);
  else startNewPost();
}

initialize();
