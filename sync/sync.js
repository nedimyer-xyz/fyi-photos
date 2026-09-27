'use strict';
// Posts new photos from your photos folder to Tumblr, one photo per post.
//
//   node sync/sync.js                    preview only: lists what would be posted
//   node sync/sync.js --post --draft     test: save new photos as Tumblr drafts
//   node sync/sync.js --post             publish new photos
//   node sync/sync.js --retag            apply tag changes to already-posted photos
//   --limit 5                            only handle the first 5 photos
//   --dir /path/to/photos                use a different photos folder
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const tumblr = require('./tumblr');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const POST = flag('--post');
const DRAFT = flag('--draft');
const RETAG = flag('--retag');
const LIMIT = option('--limit') ? parseInt(option('--limit'), 10) : Infinity;

const env = tumblr.loadEnv();
const ROOT = option('--dir')
  ? path.resolve(option('--dir'))
  : path.resolve(__dirname, '..', env.PHOTOS_DIR || 'photos');

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX_BYTES = 20 * 1024 * 1024;
// Folders that only group other folders and don't become tags themselves.
const GROUPING_FOLDERS = new Set(['travel']);
const FINDER_COLORS = new Set(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray', 'grey']);

// Drafts get their own log so a later real run still publishes those photos.
const LOG_FILE = path.join(ROOT, DRAFT ? '.tumblr-drafts.json' : '.tumblr-posted.json');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return MIME[path.extname(entry.name).toLowerCase()] ? [full] : [];
  });
}

function normalizeTag(tag) {
  return tag.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// Reads keywords (XMP dc:subject and IPTC, as written by Lightroom, Photos,
// Capture One) and the capture date (EXIF) from a JPEG's header segments.
function readJpegMeta(buf) {
  const meta = { keywords: [], date: null };
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return meta;
  let off = 2;
  while (off + 4 <= buf.length && buf[off] === 0xff) {
    const marker = buf[off + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { off += 2; continue; }
    const len = buf.readUInt16BE(off + 2);
    const seg = buf.subarray(off + 4, off + 2 + len);
    const head = seg.subarray(0, 32).toString('latin1');

    if (marker === 0xe1 && head.startsWith('Exif')) {
      for (const d of seg.toString('latin1').match(/\d{4}:\d\d:\d\d \d\d:\d\d:\d\d/g) || []) {
        const t = Date.parse(d.replace(/^(\d{4}):(\d\d):(\d\d) /, '$1-$2-$3T'));
        if (!Number.isNaN(t) && (meta.date === null || t < meta.date)) meta.date = t;
      }
    } else if (marker === 0xe1 && head.startsWith('http://ns.adobe.com/xap/1.0/')) {
      const bag = seg.toString('utf8').match(/<dc:subject>\s*<rdf:(?:Bag|Seq)>([\s\S]*?)<\/rdf:(?:Bag|Seq)>/);
      for (const m of bag ? bag[1].matchAll(/<rdf:li[^>]*>([^<]*)<\/rdf:li>/g) : []) meta.keywords.push(decodeXml(m[1]));
    } else if (marker === 0xed) {
      for (let i = 0; i + 5 <= seg.length; i++) {
        if (seg[i] === 0x1c && seg[i + 1] === 0x02 && seg[i + 2] === 0x19) {
          const n = seg.readUInt16BE(i + 3);
          meta.keywords.push(seg.subarray(i + 5, i + 5 + n).toString('utf8'));
          i += 4 + n;
        }
      }
    }
    off += 2 + len;
  }
  return meta;
}

function finderTags(file) {
  if (process.platform !== 'darwin') return [];
  try {
    const out = execFileSync('mdls', ['-raw', '-name', 'kMDItemUserTags', file], { encoding: 'utf8' });
    return out.split('\n')
      .map((s) => s.trim().replace(/,$/, '').replace(/^"(.*)"$/, '$1'))
      .filter((s) => s && !['(', ')', '(null)'].includes(s) && !FINDER_COLORS.has(s.toLowerCase()));
  } catch {
    return [];
  }
}

function describe(file) {
  const buf = fs.readFileSync(file);
  const rel = path.relative(ROOT, file);
  const meta = readJpegMeta(buf);
  const folders = path.dirname(rel).split(path.sep).filter((f) => f !== '.' && !GROUPING_FOLDERS.has(f.toLowerCase()));
  const fromName = [...path.basename(file).matchAll(/#([\w-]+)/g)].map((m) => m[1]);
  const tags = [...new Set([...folders, ...meta.keywords, ...finderTags(file), ...fromName].map(normalizeTag).filter(Boolean))];
  return {
    file,
    rel,
    size: buf.length,
    hash: crypto.createHash('sha1').update(buf).digest('hex'),
    date: meta.date ?? fs.statSync(file).mtimeMs,
    tags,
  };
}

const sameTags = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

async function main() {
  if (!fs.existsSync(ROOT)) {
    console.error(`Photos folder not found: ${ROOT}\nSet PHOTOS_DIR in sync/.env or pass --dir.`);
    process.exit(1);
  }
  const log = fs.existsSync(LOG_FILE) ? JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')) : { posts: {} };
  const saveLog = () => fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));

  const seen = new Set();
  const photos = [];
  for (const file of walk(ROOT)) {
    const p = describe(file);
    if (seen.has(p.hash)) { console.log(`Skipping duplicate file: ${p.rel}`); continue; }
    seen.add(p.hash);
    photos.push(p);
  }
  photos.sort((a, b) => a.date - b.date);

  const tooBig = photos.filter((p) => p.size > MAX_BYTES);
  const fresh = photos.filter((p) => !log.posts[p.hash] && p.size <= MAX_BYTES);
  const retag = photos.filter((p) => log.posts[p.hash] && !sameTags(log.posts[p.hash].tags, p.tags));

  console.log(`Photos folder: ${ROOT}`);
  console.log(`${photos.length} photos, ${photos.length - fresh.length - tooBig.length} already ${DRAFT ? 'saved as drafts' : 'posted'}, ${fresh.length} new\n`);

  if (fresh.length) {
    console.log('New photos, oldest first:');
    const width = Math.min(60, Math.max(...fresh.map((p) => p.rel.length)));
    for (const p of fresh) console.log(`  ${p.rel.padEnd(width)}  ${p.tags.join(', ') || '(no tags)'}`);
    console.log('');
  }
  for (const p of tooBig) console.log(`Too large for Tumblr (over 20 MB), skipped: ${p.rel}`);
  if (retag.length) {
    console.log(`Tag changes on ${retag.length} posted photo(s):`);
    for (const p of retag) console.log(`  ${p.rel}  ${log.posts[p.hash].tags.join(', ')} → ${p.tags.join(', ')}`);
    console.log('');
  }

  const travelDir = fs.readdirSync(ROOT).find((d) => d.toLowerCase() === 'travel');
  if (travelDir) {
    const trips = fs.readdirSync(path.join(ROOT, travelDir), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => normalizeTag(d.name));
    if (trips.length) console.log(`Theme setting "Travel Trip Tags": ${trips.join(',')}\n`);
  }

  if (!POST && !RETAG) {
    console.log('Preview only, nothing was posted.');
    console.log('Test with drafts: node sync/sync.js --post --draft --limit 3');
    console.log('Publish:          node sync/sync.js --post');
    if (retag.length) console.log('Update tags:      node sync/sync.js --retag');
    return;
  }

  const blog = tumblr.blogId(tumblr.requireEnv('TUMBLR_BLOG').TUMBLR_BLOG);

  if (POST) {
    let done = 0;
    for (const p of fresh.slice(0, LIMIT)) {
      const mime = MIME[path.extname(p.file).toLowerCase()];
      const form = new FormData();
      form.append('json', JSON.stringify({
        content: [{ type: 'image', media: [{ type: mime, identifier: 'photo' }] }],
        tags: p.tags.join(','),
        state: DRAFT ? 'draft' : 'published',
      }));
      form.append('photo', new Blob([fs.readFileSync(p.file)], { type: mime }), path.basename(p.file));
      try {
        const res = await tumblr.api('POST', `/blog/${blog}/posts`, { form });
        log.posts[p.hash] = { file: p.rel, postId: String(res.id_string ?? res.id), tags: p.tags, postedAt: new Date().toISOString() };
        saveLog();
        done++;
        console.log(`${DRAFT ? 'Saved draft' : 'Posted'} ${done}/${Math.min(fresh.length, LIMIT)}: ${p.rel}`);
      } catch (err) {
        if (tumblr.isRateLimit(err)) {
          console.log(`\nTumblr's daily posting limit reached after ${done} photos. Run the same command tomorrow to continue.`);
          break;
        }
        throw err;
      }
    }
  }

  if (RETAG) {
    for (const p of retag) {
      const entry = log.posts[p.hash];
      const res = await tumblr.api('GET', `/blog/${blog}/posts/${entry.postId}?post_format=npf`);
      const post = res.post || res;
      // Keep tags added by hand on Tumblr; only swap the ones this script manages.
      const removed = new Set(entry.tags.filter((t) => !p.tags.includes(t)));
      const tags = [...new Set([...(post.tags || []).filter((t) => !removed.has(t)), ...p.tags])];
      await tumblr.api('PUT', `/blog/${blog}/posts/${entry.postId}`, {
        json: { content: post.content, layout: post.layout, tags: tags.join(',') },
      });
      entry.tags = p.tags;
      entry.file = p.rel;
      saveLog();
      console.log(`Updated tags: ${p.rel} → ${tags.join(', ')}`);
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
