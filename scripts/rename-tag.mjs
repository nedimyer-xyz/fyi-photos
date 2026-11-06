// Rename a tag everywhere: Tumblr posts (post tags + per-photo "[tags]" alt
// text), the admin's lists, theme.html and the local tagger data.
//
//   node scripts/rename-tag.mjs <old-tag> <new-tag> "New Label"
//   node scripts/rename-tag.mjs dinah-dimelanta dinah-dimalanta "Dinah Dimalanta"
//
// Uses the local Tumblr login (npm run auth) and, for the admin's lists,
// BLOB_READ_WRITE_TOKEN from .env.local (npx vercel env pull).
import { readFileSync, existsSync } from 'node:fs';
import { BLOG, TAGS_FILE, readJSON, writeJSON, readConfig, writeConfig, parseAlt, buildAlt, slug, sleep, CATEGORIES } from '../migration/lib.mjs';
import { api } from '../migration/auth.mjs';

const [oldTag, newTagArg, label] = process.argv.slice(2);
const newTag = slug(newTagArg);
if (!oldTag || !newTag || !label) {
  console.error('Usage: node scripts/rename-tag.mjs <old-tag> <new-tag> "New Label"');
  process.exit(1);
}

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const swap = (list) => [...new Set(list.map((t) => (slug(t) === oldTag ? newTag : t)))];
function renameEntry(cfg) {
  let found = false;
  for (const cat of CATEGORIES) {
    for (const e of cfg[cat] || []) {
      if (e.tag === oldTag || e.tag === newTag) { e.tag = newTag; e.label = label; found = true; }
    }
    const seen = new Set();
    cfg[cat] = (cfg[cat] || []).filter((e) => !seen.has(e.tag) && seen.add(e.tag));
  }
  return found;
}

// 1. Admin lists (source of truth for the theme the admin hands out)
if (process.env.BLOB_READ_WRITE_TOKEN) {
  const { readStore, updateStore } = await import('../server/store.mjs');
  const { data } = await readStore();
  const cfg = structuredClone(data.config);
  if (renameEntry(cfg)) {
    await updateStore(data.configRev, (d) => ({ ...d, config: cfg }));
    console.log('✓ Admin lists updated');
  } else console.log('· Admin lists: tag not found');
} else console.log('· Skipped admin lists (no BLOB_READ_WRITE_TOKEN)');

// 2. theme.html in the repo
const cfg = await readConfig();
if (renameEntry(cfg)) { await writeConfig(cfg); console.log('✓ theme.html updated'); }

// 3. Local tagger data
const local = await readJSON(TAGS_FILE, null);
if (local) {
  let n = 0;
  for (const m of Object.values(local.photos)) for (const k of Object.keys(m)) {
    if (m[k].includes(oldTag)) { m[k] = swap(m[k]).sort(); n++; }
  }
  await writeJSON(TAGS_FILE, local);
  console.log(`✓ Local tags.json: ${n} photos`);
}

// 4. Tumblr posts
let changed = 0, checked = 0;
for (let offset = 0; ; offset += 20) {
  const r = await api('GET', `/blog/${BLOG}/posts?npf=true&limit=20&offset=${offset}`);
  for (const post of r.posts) {
    checked++;
    if (!Array.isArray(post.content) || !post.content.length) continue;
    let hit = (post.tags || []).some((t) => slug(t) === oldTag);
    const content = post.content.map((b) => {
      if (b.type !== 'image' || !b.alt_text) return b;
      const a = parseAlt(b.alt_text);
      if (!a.tags.includes(oldTag)) return b;
      hit = true;
      return { ...b, alt_text: buildAlt(a.desc, swap(a.tags)) };
    });
    if (!hit) continue;
    const body = {
      content,
      layout: post.layout || [],
      tags: swap(post.tags || []).join(','),
      date: new Date(post.timestamp * 1000).toISOString(),
    };
    if (post.slug) body.slug = post.slug;
    if (post.state && post.state !== 'published') body.state = post.state;
    if (post.interactability_reblog) body.interactability_reblog = post.interactability_reblog;
    await api('PUT', `/blog/${BLOG}/posts/${post.id_string}`, body);
    changed++;
    console.log(`  ✓ ${post.id_string}`);
    await sleep(1100);
  }
  if (!r.posts.length || offset + 20 >= r.total_posts) break;
  await sleep(300);
}
console.log(`✓ Tumblr: ${changed} posts updated (${checked} checked)`);
console.log('Next: copy the updated theme from the admin banner and paste it into Tumblr.');
