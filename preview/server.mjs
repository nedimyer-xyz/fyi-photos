// Local preview server for theme.html.
// Renders the Tumblr template with sample posts (from fetch-sample.mjs) and
// fake tags so every page type can be checked before pasting into Tumblr.
//
//   node preview/fetch-sample.mjs   # once, downloads sample posts
//   node preview/server.mjs         # http://localhost:4321
//   node preview/server.mjs --real  # your exported posts + tags from the tagger
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const THEME = join(here, '..', 'theme.html');
const PORT = Number(process.env.PORT || 4321);
const REAL = process.argv.includes('--real');
const PER_PAGE = Number(process.env.PER_PAGE || (REAL ? 10 : 4));
const DELAY = Number(process.env.PREVIEW_DELAY || 0);

// Tumblr variables/blocks the theme is allowed to use. Anything else that looks
// like {Word} would be at risk of being swallowed by Tumblr's template parser.
const KNOWN = new Set([
  'Tag', 'RSS', 'CustomCSS', 'PostID', 'Timestamp', 'Body', 'Caption', 'NextPage', 'PhotoAlt',
  'PhotoURL-HighRes', 'PhotoWidth-HighRes', 'PhotoHeight-HighRes',
]);

// Fake tags so People / Travel / Series pages have something to show.
const TAG_SETS = [
  ['people', 'bucky', 'japan'],
  ['travel', 'italy'],
  ['series', 't-dock'],
  ['people', 'alaa'],
  ['travel', 'japan'],
  ['series', 'challis'],
  ['people', 'camille', 'travel', 'mexico'],
  ['travel', 'thailand'],
  ['people', 'peter'],
  ['travel', 'spain'],
  ['people', 'cl'],
];

const CATEGORY_TAGS = new Set(['people', 'travel', 'series']);

// Give most sample posts per-photo tags in the alt text (as the migration will),
// alternating between the post's specific tags. Every 4th post stays untagged
// to exercise the "show everything" fallback.
function withPhotoTags(body, tags, i) {
  if (i % 4 === 3) return body;
  const specific = tags.filter((t) => !CATEGORY_TAGS.has(t));
  let n = 0;
  return body.replace(/alt="image"/g, () => `alt="[${specific[n++ % specific.length]}]"`);
}

async function loadPosts() {
  try {
    const raw = JSON.parse(await readFile(join(here, '.cache', 'posts.json'), 'utf8'));
    return raw.map((p, i) => {
      const tags = TAG_SETS[i % TAG_SETS.length];
      return { ...p, tags, body: withPhotoTags(p.body, tags, i) };
    });
  } catch {
    console.error('No sample data. Run: node preview/fetch-sample.mjs');
    process.exit(1);
  }
}

/* ── Real data: migration export + tagger state ─────────── */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Width of a Tumblr rendition like …/s400x600/… for a photo of ratio w/h.
function renditionWidth(url, w, h) {
  const m = url.match(/\/s(\d+)x(\d+)/);
  if (!m || !w || !h) return 0;
  return Math.round(Math.min(Number(m[1]), Number(m[2]) * (w / h), w));
}

async function loadRealPosts() {
  const lib = await import('../migration/lib.mjs');
  const exported = await lib.readJSON(lib.POSTS_FILE, null);
  if (!exported) {
    console.error('No export found. Run: npm run export');
    process.exit(1);
  }
  const state = await lib.readJSON(lib.TAGS_FILE, { photos: {} });
  const cfg = await lib.readConfig();
  return exported.posts.map((p) => {
    const photoTags = state.photos[p.id];
    const tagsFor = (ph) => (photoTags ? photoTags[ph.key] || [] : ph.altTags || []);
    const body = p.photos.map((ph) => {
      const tw = renditionWidth(ph.thumb, ph.w, ph.h);
      const fw = renditionWidth(ph.full, ph.w, ph.h);
      const srcset = tw && fw && tw !== fw ? ` srcset="${esc(ph.thumb)} ${tw}w, ${esc(ph.full)} ${fw}w"` : '';
      const alt = lib.buildAlt(ph.alt, tagsFor(ph)) || 'image';
      return `<div class="npf_row"><figure class="tmblr-full" data-orig-width="${ph.w}" data-orig-height="${ph.h}">`
        + `<a class="post_media_photo_anchor" data-big-photo="${esc(ph.full)}" data-big-photo-width="${ph.w}" data-big-photo-height="${ph.h}">`
        + `<img src="${esc(ph.full)}"${srcset} alt="${esc(alt)}"></a>`
        + (alt && alt !== 'image' ? '<span class="tmblr-alt-text-helper">ALT</span>' : '') // Tumblr adds this badge
        + `</figure></div>`;
    }).join('');
    const tags = photoTags ? lib.computePostTags(p.tags, p.photos.map(tagsFor), cfg) : p.tags;
    return { id: p.id, body, tags: tags.map(lib.slug), ts: Math.round(Date.parse(p.date) / 1000) };
  });
}

// Minimal Tumblr template renderer: {block:Name}…{/block:Name} and {Var}.
// Single pass, so substituted content (e.g. post bodies) is never re-parsed.
const TOKEN = /\{block:([A-Za-z]+)\}([\s\S]*?)\{\/block:\1\}|\{([A-Za-z][A-Za-z0-9-]*)\}/g;
function render(tpl, scope) {
  return tpl.replace(TOKEN, (m, block, inner, name) => {
    if (block) {
      const v = scope['block:' + block];
      if (Array.isArray(v)) return v.map((item) => render(inner, { ...scope, ...item })).join('');
      return v ? render(inner, scope) : '';
    }
    return Object.prototype.hasOwnProperty.call(scope, name) ? String(scope[name]) : m;
  });
}

function lintTheme(tpl) {
  const stripped = tpl.replace(/\{\/?block:[A-Za-z]+\}/g, '');
  const unknown = new Set();
  for (const m of stripped.matchAll(/\{([A-Za-z][A-Za-z0-9-]*)\}/g)) {
    if (!KNOWN.has(m[1])) unknown.add(m[0]);
  }
  if (unknown.size) console.warn('⚠ Possible Tumblr variable collisions:', [...unknown].join(' '));
  else console.log('✓ No stray {Word} patterns that Tumblr could misinterpret');
}

function pageScope(route, posts) {
  const { kind, tag, page, id } = route;
  let list = posts;
  if (kind === 'tag') list = posts.filter((p) => p.tags.includes(tag));
  if (kind === 'post') list = posts.filter((p) => p.id === id);
  if (kind === 'page') list = [{ id: 'info', body: '<p>Placeholder for your Tumblr <b>/info</b> page. Write it in Tumblr → Edit appearance → Pages.</p>' }];
  const start = (page - 1) * PER_PAGE;
  const single = kind === 'post' || kind === 'page';
  const slice = single ? list : list.slice(start, start + PER_PAGE);
  const hasNext = kind !== 'post' && start + PER_PAGE < list.length;
  const base = kind === 'tag' ? `/tagged/${encodeURIComponent(tag)}` : '';

  return {
    RSS: '/rss',
    CustomCSS: '',
    Tag: tag || '',
    'block:IndexPage': !single,
    'block:PermalinkPage': single,
    'block:TagPage': kind === 'tag',
    'block:SearchPage': false,
    'block:DayPage': false,
    'block:Pagination': hasNext || page > 1,
    'block:NextPage': hasNext,
    NextPage: `${base}/page/${page + 1}`,
    'block:Posts': slice.map((p) => ({
      PostID: p.id,
      Timestamp: p.ts || '',
      Body: p.body,
      'block:Text': true,
      'block:Photo': false,
      'block:Photoset': false,
    })),
  };
}

function route(pathname) {
  let m;
  if ((m = pathname.match(/^\/(?:page\/(\d+)\/?)?$/))) return { kind: 'index', page: Number(m[1] || 1) };
  if ((m = pathname.match(/^\/tagged\/([^/]+)(?:\/page\/(\d+))?\/?$/)))
    return { kind: 'tag', tag: decodeURIComponent(m[1]).toLowerCase(), page: Number(m[2] || 1) };
  if ((m = pathname.match(/^\/post\/(\d+)/))) return { kind: 'post', id: m[1], page: 1 };
  if (/^\/info\/?$/.test(pathname)) return { kind: 'page', page: 1 };
  return null;
}

const load = REAL ? loadRealPosts : loadPosts;
const initial = await load();
lintTheme(await readFile(THEME, 'utf8'));

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const r = route(url.pathname);
  if (!r) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }
  if (DELAY && r.page > 1) await new Promise((ok) => setTimeout(ok, DELAY));
  const tpl = await readFile(THEME, 'utf8'); // re-read so edits show on refresh
  const posts = REAL ? await load() : initial; // real mode picks up new tags on refresh
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  // Tumblr injects its NPF stylesheet into every blog page; include it so the preview matches.
  const html = render(tpl, pageScope(r, posts)).replace('<head>', '<head>\n<link rel="stylesheet" media="screen" href="https://assets.tumblr.com/client/prod/standalone/blog-network-npf/index.build.css">');
  res.end(html);
}).listen(PORT, () => {
  console.log(`Preview: http://localhost:${PORT}  (${initial.length} ${REAL ? 'real' : 'sample'} posts, ${PER_PAGE}/page)`);
});
