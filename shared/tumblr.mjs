// Tumblr API helpers shared by the admin site. Uses global fetch (Node 18+).
import { npfImages, parseAlt, buildAlt, computePostTags, pickSize, managedTags, slug, CATEGORIES } from './core.mjs';

export const API = () => process.env.TUMBLR_API || 'https://api.tumblr.com/v2';
export const WWW = () => process.env.TUMBLR_WWW || 'https://www.tumblr.com';

export class TumblrError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function tumblr(token, method, path, body) {
  const init = { method, headers: { authorization: `Bearer ${token}` } };
  if (body instanceof FormData) init.body = body;
  else if (body) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(API() + path, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (json.errors && json.errors.map((e) => e.detail || e.title).join('; ')) || json.meta?.msg || res.statusText;
    throw new TumblrError(res.status, `Tumblr ${res.status}: ${detail}`);
  }
  return json.response;
}

/* ── Reading ────────────────────────────────────────────── */

// Compact post for the admin UI. Photo tags come from "[tags]" in alt text; if a
// post has none yet, its managed post tags are used as a starting point.
export function slimPost(p, cfg) {
  const managed = managedTags(cfg);
  const imgs = npfImages(p.content);
  const photos = imgs.map(({ key, block }) => {
    const a = parseAlt(block.alt_text);
    return {
      key,
      thumb: pickSize(block.media, 400),
      full: pickSize(block.media, 1280),
      w: block.media[0].width || 0,
      h: block.media[0].height || 0,
      desc: a.desc,
      tags: a.tags,
    };
  });
  const hasAltTags = photos.some((ph) => ph.tags.length);
  if (!hasAltTags) {
    const postTags = (p.tags || []).map(slug).filter((t) => managed.has(t) && !CATEGORIES.includes(t));
    for (const ph of photos) ph.tags = [...postTags];
  }
  return {
    id: p.id_string || String(p.id),
    date: new Date(p.timestamp * 1000).toISOString(),
    url: p.post_url,
    state: p.state || 'published',
    tags: p.tags || [],
    npf: Array.isArray(p.content) && p.content.length > 0 && p.is_blocks_post_format !== false,
    photos,
  };
}

export async function listPosts(token, blog, offset, cfg) {
  const r = await tumblr(token, 'GET', `/blog/${blog}/posts?npf=true&limit=20&offset=${offset}`);
  return { total: r.total_posts, posts: r.posts.map((p) => slimPost(p, cfg)) };
}

export async function getPost(token, blog, id) {
  const r = await tumblr(token, 'GET', `/blog/${blog}/posts/${id}`);
  return r.post || (r.posts && r.posts[0]) || r;
}

/* ── Editing tags ───────────────────────────────────────── */

// Save per-photo tags ({ photoKey: [tags] }) to a post: rewrites only image alt
// text and post tags; content, layout, date and state are kept.
export async function savePhotoTags(token, blog, id, photoTags, cfg) {
  const post = await getPost(token, blog, id);
  if (!Array.isArray(post.content) || !post.content.length) {
    throw new TumblrError(422, 'This is an old-format post. Edit it on tumblr.com.');
  }
  const imgs = npfImages(post.content);
  const lists = imgs.map(({ key }) => photoTags[key] || []);
  const tags = computePostTags(post.tags || [], lists, cfg);
  const content = post.content.map((block) => {
    if (block.type !== 'image') return block;
    const key = npfImages([block])[0]?.key;
    if (!key || !(key in photoTags)) return block;
    const alt = buildAlt(parseAlt(block.alt_text).desc, photoTags[key] || []);
    const next = { ...block };
    if (alt) next.alt_text = alt;
    else delete next.alt_text;
    return next;
  });
  const body = {
    content,
    layout: post.layout || [],
    tags: tags.join(','),
    date: new Date(post.timestamp * 1000).toISOString(),
  };
  if (post.slug) body.slug = post.slug;
  if (post.state && post.state !== 'published') body.state = post.state;
  if (post.interactability_reblog) body.interactability_reblog = post.interactability_reblog;
  await tumblr(token, 'PUT', `/blog/${blog}/posts/${id}`, body);
  return slimPost({ ...post, content, tags }, cfg);
}

/* ── Creating posts ─────────────────────────────────────── */

// photos: [{ data: Blob|Buffer, type, width, height, tags: [] }]
export async function createPhotoPost(token, blog, { photos, caption, state, date }, cfg) {
  const content = photos.map((ph, i) => {
    const block = {
      type: 'image',
      media: [{ type: ph.type || 'image/jpeg', identifier: `photo${i}`, width: ph.width, height: ph.height }],
    };
    const alt = buildAlt('', ph.tags || []);
    if (alt) block.alt_text = alt;
    return block;
  });
  if (caption && caption.trim()) content.push({ type: 'text', text: caption.trim() });
  const tags = computePostTags([], photos.map((ph) => ph.tags || []), cfg);
  const json = { content, tags: tags.join(','), state: state || 'published' };
  if (date) json.date = new Date(date).toISOString();

  const form = new FormData();
  form.append('json', new Blob([JSON.stringify(json)], { type: 'application/json' }));
  photos.forEach((ph, i) => {
    const blob = ph.data instanceof Blob ? ph.data : new Blob([ph.data], { type: ph.type || 'image/jpeg' });
    form.append(`photo${i}`, blob, `photo${i}.jpg`);
  });
  const r = await tumblr(token, 'POST', `/blog/${blog}/posts`, form);
  return { id: String(r.id_string || r.id), state: json.state, tags };
}
