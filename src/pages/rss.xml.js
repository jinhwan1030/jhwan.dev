import rss from '@astrojs/rss';
import { SITE_DESCRIPTION, SITE_TITLE } from '../consts';
import { getContentRuntime } from '../lib/server/content-runtime.js';

export async function GET(context) {
	const posts = getContentRuntime().repository.listPublished();
	const response = await rss({
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		site: context.site,
		items: posts.map((post) => ({
			title: post.title,
			description: post.description,
			pubDate: new Date(post.publishedAt),
			link: `/blog/${post.slug}/`,
		})),
	});
	response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
	return response;
}
