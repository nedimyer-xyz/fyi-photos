// Export every post (and every photo in it) to migration/data/posts.json,
// plus an untouched timestamped backup used by rollback.
//
//   npm run export
//
// Uses the official API (NPF) when logged in via `npm run auth`; otherwise
// falls back to the blog's public feed, which is enough to start tagging.
import { copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BLOG, DATA, POSTS_FILE, writeJSON, photoKey, parseAlt, npfImages, pickSize, sleep } from './lib.mjs';
import { api, getSecrets } from './auth.mjs';

const SITE = process.env.FYI_SITE || 'https://fyi.photos';

async function exportNpf() {
  const posts = [];
  for (let offset = 0; ; offset += 20) {
    const r = await api('GET', `/blog/${BLOG}/posts?npf=true&limit=20&offset=${offset}`);
    for (const p of r.posts) {
      const photos = npfImages(p.content).map(({ key, block }) => ({
        key,
        thumb: pickSize(block.media, 400),
        full: pickSize(block.media, 1280),
        w: block.media[0].width,
        h: block.media[0].height,
        alt: parseAlt(block.alt_text).desc,
        altTags: parseAlt(block.alt_text).tags,
      }));
      posts.push({
        id: p.id_string,
        date: new Date(p.timestamp * 1000).toISOString(),
        url: p.post_url,
        tags: p.tags || [],
        npf: p.is_blocks_post_format !== false,
        photos,
      });
    }
    process.stdout.write(`\r  ${posts.length} / ${r.total_posts} posts`);
    if (!r.posts.length || posts.length >= r.total_posts) break;
    await sleep(400);
  }
  process.stdout.write('\n');
  return posts;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : '';
}

function photosFromHtml(html) {
  const out = [];
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0];
    const src = attr(tag, 'src');
    const key = photoKey(src);
    if (!key || !/media\.tumblr\.com/.test(src)) continue;
    const set = attr(tag, 'srcset').split(',').map((s) => s.trim().split(/\s+/))
      .map(([url, w]) => ({ url, width: parseInt(w, 10) || 0 }))
      .filter((e) => e.url && e.width && !/_c1\//.test(e.url));
    const { desc, tags } = parseAlt(attr(tag, 'alt'));
    out.push({
      key,
      thumb: set.length ? pickSize(set, 400) : src,
      full: set.length ? pickSize(set, 1280) : src,
      w: Number(attr(tag, 'data-orig-width')) || 0,
      h: Number(attr(tag, 'data-orig-height')) || 0,
      alt: desc,
      altTags: tags,
    });
  }
  return out;
}

async function exportPublic() {
  const posts = [];
  for (let start = 0; ; start += 50) {
    const res = await fetch(`${SITE}/api/read/json?num=50&start=${start}`);
    if (!res.ok) throw new Error(`Public feed returned ${res.status}`);
    const text = await res.text();
    const d = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    for (const p of d.posts) {
      let photos = [];
      if (p.type === 'photo') {
        const list = p.photos && p.photos.length ? p.photos : [p];
        photos = list.map((ph) => {
          const full = ph['photo-url-1280'];
          return { key: photoKey(full), thumb: ph['photo-url-400'] || full, full,
                   w: Number(ph.width) || 0, h: Number(ph.height) || 0, alt: '', altTags: [] };
        }).filter((ph) => ph.key);
      }
      photos = photos.concat(photosFromHtml((p['regular-body'] || '') + (p['photo-caption'] || '')));
      const seen = new Set();
      photos = photos.filter((ph) => !seen.has(ph.key) && seen.add(ph.key));
      posts.push({
        id: String(p.id),
        date: new Date(p['unix-timestamp'] * 1000).toISOString(),
        url: p.url,
        tags: p.tags || [],
        npf: p.type === 'regular' || p.type === 'photo',
        photos,
      });
    }
    process.stdout.write(`\r  ${posts.length} / ${d['posts-total']} posts`);
    if (!d.posts.length || posts.length >= d['posts-total']) break;
    await sleep(400);
  }
  process.stdout.write('\n');
  return posts;
}

const loggedIn = !!(await getSecrets()).access_token;
console.log(loggedIn ? `Exporting ${BLOG} via the Tumblr API…` : `Exporting ${SITE} via the public feed (not logged in)…`);
const posts = await (loggedIn ? exportNpf() : exportPublic());
posts.sort((a, b) => b.date.localeCompare(a.date));

const data = { blog: BLOG, source: loggedIn ? 'api' : 'public', exportedAt: new Date().toISOString(), posts };
if (existsSync(POSTS_FILE)) {
  // Keep the previous export around in case tagging was based on it.
  await copyFile(POSTS_FILE, join(DATA, `posts-prev-${Date.now()}.json`));
}
await writeJSON(POSTS_FILE, data);
const backup = join(DATA, `backup-${data.exportedAt.replace(/[:.]/g, '-')}.json`);
await writeJSON(backup, data);

const photos = posts.reduce((n, p) => n + p.photos.length, 0);
console.log(`✓ ${posts.length} posts, ${photos} photos → ${POSTS_FILE}`);
console.log(`  backup → ${backup}`);
const odd = posts.filter((p) => !p.npf);
if (odd.length) console.log(`  ⚠ ${odd.length} legacy-format posts may need manual editing: ${odd.map((p) => p.id).join(', ')}`);
