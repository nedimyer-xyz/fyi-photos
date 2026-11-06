// Downloads a handful of real posts from fyi.photos so the theme can be
// previewed locally with realistic image data. Output: preview/.cache/posts.json
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = process.env.FYI_SITE || 'https://fyi.photos';
const PAGES = Number(process.env.FYI_PAGES || 4);
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '.cache', 'posts.json');

// Return the inner HTML of the <div> that starts at `start`, honoring nesting.
function innerDiv(html, start) {
  const open = html.indexOf('>', start) + 1;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = open;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(open, m.index);
  }
  return '';
}

const posts = [];
const seen = new Set();
for (let p = 1; p <= PAGES; p++) {
  const url = p === 1 ? `${SITE}/` : `${SITE}/page/${p}`;
  const res = await fetch(url);
  if (!res.ok) break;
  const html = await res.text();
  const re = /<article[^>]*\bid="(\d+)"[^>]*>/g;
  let m;
  let found = 0;
  while ((m = re.exec(html))) {
    const id = m[1];
    const start = html.indexOf('<div class="text-content">', m.index);
    if (start === -1 || seen.has(id)) continue;
    const body = innerDiv(html, start).trim();
    if (!body) continue;
    seen.add(id);
    posts.push({ id, body });
    found++;
  }
  console.log(`page ${p}: ${found} posts`);
  if (!found) break;
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(posts));
console.log(`saved ${posts.length} posts → ${out}`);
