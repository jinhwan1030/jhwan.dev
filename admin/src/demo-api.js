export class DemoApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'DemoApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const DEMO_POSTS = [
  {
    id: 'demo-1',
    slug: 'database-content-preview',
    title: 'DB 콘텐츠 관리 화면 미리보기',
    description: '새 관리자 화면에서 글을 작성하고 발행하는 흐름을 점검하는 예시 글입니다.',
    bodyMarkdown: `## 글쓰기에 집중하는 화면

왼쪽에는 글 목록이 항상 보이고, 가운데에는 넓은 편집기가 있습니다.

- 저장 상태를 바로 확인할 수 있습니다.
- **서식 도구**를 눌러 Markdown을 몰라도 글을 쓸 수 있습니다.
- 오른쪽에서 공개 상태와 주소를 관리합니다.

> 이 화면은 아직 운영 API에 연결되지 않은 로컬 미리보기입니다.

| 항목 | 상태 |
| --- | --- |
| SQLite 저장소 | 준비됨 |
| 관리자 API | 준비됨 |
| 운영 연결 | 다음 구간 |
`,
    category: '개발',
    status: 'published',
    heroImagePath: null,
    publishedAt: '2026-08-19T03:00:00.000Z',
    contentUpdatedAt: '2026-08-19T05:30:00.000Z',
    createdAt: '2026-08-19T03:00:00.000Z',
    updatedAt: '2026-08-19T05:30:00.000Z',
    deletedAt: null,
    version: 3,
  },
  {
    id: 'demo-2',
    slug: 'next-homelab-note',
    title: '다음 홈랩 기록',
    description: '아직 다듬고 있는 비공개 초안입니다.',
    bodyMarkdown: '## 메모\n\n여기서부터 편하게 작성하면 됩니다.\n',
    category: '홈랩',
    status: 'draft',
    heroImagePath: null,
    publishedAt: null,
    contentUpdatedAt: null,
    createdAt: '2026-08-18T02:00:00.000Z',
    updatedAt: '2026-08-19T01:10:00.000Z',
    deletedAt: null,
    version: 1,
  },
  {
    id: 'demo-3',
    slug: 'babyweather-operation-note',
    title: '아이날씨 운영 메모',
    description: '위치 검색 공급자 전환 후 남길 운영 기록입니다.',
    bodyMarkdown: '## 확인할 것\n\n- TMAP 검색 품질\n- 카카오 보조 호출량\n',
    category: '프로젝트',
    status: 'draft',
    heroImagePath: null,
    publishedAt: null,
    contentUpdatedAt: null,
    createdAt: '2026-08-17T09:00:00.000Z',
    updatedAt: '2026-08-18T12:20:00.000Z',
    deletedAt: null,
    version: 2,
  },
];

const clone = (value) => structuredClone(value);
const wait = () => new Promise((resolve) => setTimeout(resolve, 80));

export function createDemoAdminApi({ clock = () => Date.now() } = {}) {
  let posts = clone(DEMO_POSTS);
  let nextId = 4;
  const revisions = new Map(
    posts.map((post) => [post.id, [{ version: post.version, snapshot: clone(post), createdAt: post.updatedAt }]]),
  );

  function findPost(id) {
    const post = posts.find((candidate) => candidate.id === id);
    if (!post) throw new DemoApiError(404, 'post_not_found', '글을 찾을 수 없습니다.');
    return post;
  }

  function assertVersion(post, expectedVersion) {
    if (post.version !== expectedVersion) {
      throw new DemoApiError(409, 'version_conflict', '다른 화면에서 글이 먼저 수정되었습니다.', {
        actualVersion: post.version,
      });
    }
  }

  function assertSlug(slug, currentId = null) {
    if (posts.some((post) => post.slug === slug && post.id !== currentId)) {
      throw new DemoApiError(409, 'slug_conflict', '이미 사용 중인 글 주소입니다.');
    }
  }

  function addRevision(post) {
    const history = revisions.get(post.id) ?? [];
    history.unshift({ version: post.version, snapshot: clone(post), createdAt: post.updatedAt });
    revisions.set(post.id, history);
  }

  return {
    async listPosts({ includeDeleted = true } = {}) {
      await wait();
      return clone(
        posts
          .filter((post) => includeDeleted || !post.deletedAt)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      );
    },

    async getPost(id) {
      await wait();
      return clone(findPost(id));
    },

    async createPost(input) {
      await wait();
      assertSlug(input.slug);
      const timestamp = new Date(clock()).toISOString();
      const post = {
        ...clone(input),
        id: `demo-${nextId++}`,
        publishedAt: input.status === 'published' ? (input.publishedAt ?? timestamp) : null,
        contentUpdatedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
        version: 1,
      };
      posts.unshift(post);
      addRevision(post);
      return clone(post);
    },

    async updatePost(id, { expectedVersion, ...patch }) {
      await wait();
      const post = findPost(id);
      assertVersion(post, expectedVersion);
      if (patch.slug) assertSlug(patch.slug, id);
      const timestamp = new Date(clock()).toISOString();
      Object.assign(post, clone(patch), {
        version: post.version + 1,
        updatedAt: timestamp,
        contentUpdatedAt: timestamp,
      });
      if (post.status === 'published' && !post.publishedAt) post.publishedAt = timestamp;
      addRevision(post);
      return clone(post);
    },

    async deletePost(id, { expectedVersion }) {
      await wait();
      const post = findPost(id);
      assertVersion(post, expectedVersion);
      const timestamp = new Date(clock()).toISOString();
      Object.assign(post, { deletedAt: timestamp, updatedAt: timestamp, version: post.version + 1 });
      addRevision(post);
      return clone(post);
    },

    async restorePost(id, { expectedVersion }) {
      await wait();
      const post = findPost(id);
      assertVersion(post, expectedVersion);
      const timestamp = new Date(clock()).toISOString();
      Object.assign(post, { deletedAt: null, updatedAt: timestamp, version: post.version + 1 });
      addRevision(post);
      return clone(post);
    },

    async listRevisions(id) {
      await wait();
      findPost(id);
      return clone(revisions.get(id) ?? []);
    },
  };
}
