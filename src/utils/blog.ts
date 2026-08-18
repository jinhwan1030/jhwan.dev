import { getCollection, type CollectionEntry } from 'astro:content';

export function sortBlogPosts(posts: CollectionEntry<'blog'>[]) {
  return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export async function getVisibleBlogPosts() {
  const posts = await getCollection('blog');
  const visiblePosts = import.meta.env.DEV
    ? posts
    : posts.filter((post) => !post.data.draft);

  return sortBlogPosts(visiblePosts);
}
