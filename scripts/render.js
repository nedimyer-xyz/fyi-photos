// Local preview renderer for fyi-photos Tumblr theme.
// Fills Tumblr template tags with sample data so you can open the
// output in a browser without uploading to Tumblr.
//
// Usage:
//   node scripts/render.js theme.html out/index.html index
//   node scripts/render.js theme.html out/permalink.html permalink
//   PAGE=tag TAG=portraits node scripts/render.js theme.html out/tag.html tag

'use strict';
const fs   = require('fs');
const path = require('path');

const srcFile = process.argv[2];
const outFile = process.argv[3];
const pageType = process.env.PAGE || process.argv[4] || 'index'; // index | permalink | tag

if (!srcFile || !outFile) {
  console.error('Usage: node render.js <theme.html> <out.html> [index|permalink|tag]');
  process.exit(1);
}

let html = fs.readFileSync(srcFile, 'utf8');
const outDir = path.dirname(outFile);
fs.mkdirSync(outDir, { recursive: true });

// ── Tumblr option defaults from meta tags ──────────────────────────────────
const opts = {};
html.replace(/<meta name="(color|text|image|select|if):([^"]+)"\s+content="([^"]*)"/g, (_, type, name, val) => {
  const key = `${type}:${name}`;
  if (!(key in opts)) opts[key] = val;
});
// Overrides from env
if (process.env.LAYOUT)     opts['select:Layout']     = process.env.LAYOUT;
if (process.env.COLUMNS)    opts['select:Columns']    = process.env.COLUMNS;
if (process.env.TYPEFACE)   opts['select:Typeface']   = process.env.TYPEFACE;

// ── Sample image helper (inline SVG, no network) ───────────────────────────
const HUES = [24, 200, 150, 340, 45, 275, 15, 190, 60, 310, 170, 90];
function svgImg(w, h, seed = 0) {
  const h1 = HUES[seed % HUES.length];
  const h2 = HUES[(seed + 4) % HUES.length];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>`
    + `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>`
    + `<stop offset='0' stop-color='hsl(${h1},38%,62%)'/>`
    + `<stop offset='1' stop-color='hsl(${h2},34%,42%)'/>`
    + `</linearGradient></defs>`
    + `<rect width='100%' height='100%' fill='url(#g)'/>`
    + `</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// ── Block helpers ──────────────────────────────────────────────────────────
function block(str, name, keep) {
  return str.replace(
    new RegExp(`\\{block:${name}\\}([\\s\\S]*?)\\{/block:${name}\\}`, 'g'),
    keep ? '$1' : ''
  );
}
function stripBlockTags(str, name) {
  return str
    .replace(new RegExp(`\\{block:${name}\\}`, 'g'), '')
    .replace(new RegExp(`\\{/block:${name}\\}`, 'g'), '');
}
function toggleBlock(str, name, on) {
  str = block(str, name, on);
  str = block(str, 'Not' + name, !on);
  return str;
}

// ── Photo tile HTML ────────────────────────────────────────────────────────
function photoTile(i, extra = '') {
  const w = 500, h = [500, 750, 400, 625, 500][i % 5];
  const src = svgImg(w, h, i);
  return `
<figure class="tile tile-grid" data-lb-src="${src}" data-lb-alt="Photo ${i}" data-permalink="/post/${i}">
  <img src="${src}" alt="Photo ${i}" width="${w}" height="${h}" loading="lazy"${extra}>
</figure>`;
}

function photosetTile(i) {
  const images = [0, 1, 2].map((k) => {
    const w = 800, h = 600;
    const src = svgImg(w, h, i * 3 + k);
    const cls = k > 0 ? ' class="extra-img"' : '';
    return `  <img src="${src}" alt="set ${k}" width="${w}" height="${h}" loading="lazy" data-hires="${src}"${cls}>`;
  }).join('\n');
  return `
<figure class="tile tile-grid" data-photoset="1" data-permalink="/post/${i}">
${images}
</figure>`;
}

function buildPosts(n = 18) {
  let out = '';
  for (let i = 1; i <= n; i++) {
    if (i % 6 === 0) out += photosetTile(i);
    else              out += photoTile(i);
  }
  return out;
}

// ── Page-block selection ───────────────────────────────────────────────────
const activeTag = process.env.TAG || 'portraits';
let out = html;

out = block(out, 'IndexPage',     pageType === 'index');
out = block(out, 'TagPage',       pageType === 'tag');
out = block(out, 'SearchPage',    pageType === 'search');
out = block(out, 'PermalinkPage', pageType === 'permalink');

// Pagination
out = block(out, 'Pagination',  pageType === 'index' || pageType === 'tag');
out = block(out, 'NextPage',    pageType === 'index' || pageType === 'tag');
out = block(out, 'PreviousPage', false);

// Tag detection blocks (Tag1, Tag2, Tag3)
const tag1 = opts['text:Tag 1 Slug'] || 'portraits';
const tag2 = opts['text:Tag 2 Slug'] || 't-dock';
const tag3 = opts['text:Tag 3 Slug'] || 'challis';
out = block(out, 'Tag1', pageType === 'tag' && activeTag === tag1);
out = block(out, 'Tag2', pageType === 'tag' && activeTag === tag2);
out = block(out, 'Tag3', pageType === 'tag' && activeTag === tag3);

// Lightbox
out = block(out, 'IfUseLightbox', opts['if:Use Lightbox'] !== '0');

// Description
out = block(out, 'Description', true);

// NoSearchResults
out = block(out, 'NoSearchResults', false);

// Posts
if (pageType === 'index' || pageType === 'tag' || pageType === 'search') {
  out = out.replace(/\{block:Posts\}[\s\S]*?\{\/block:Posts\}/g, buildPosts(18));
} else if (pageType === 'permalink') {
  const w = 1200, h = 800;
  const src = svgImg(w, h, 42);
  const single = `<img class="permalink-photo" src="${src}" alt="Lead photo" width="${w}" height="${h}">`;
  out = out.replace(/\{block:Posts\}[\s\S]*?\{\/block:Posts\}/g, single);
}

// Strip remaining block wrapper tags (keep inner content)
[
  'Photo','Photoset','Photos','NotFirst','Text','Quote','Link','Video',
  'Audio','Chat','Answer','Date','HasTags','Tags','NoteCount',
  'IfShowCameraInfo','Exif','Camera','FocalLength','Aperture','Exposure',
  'PermalinkPagination','NextPost','PreviousPost','PostNotes','RebloggedFrom',
  'Caption','Title','Source','Lines','Label',
].forEach(b => { out = stripBlockTags(out, b); });

// ── Substitute options ─────────────────────────────────────────────────────
out = out.replace(/\{(color|text|image|select|if):([^}]+)\}/g, (m, type, name) => {
  return opts[`${type}:${name}`] || '';
});

// ── Substitute global vars ─────────────────────────────────────────────────
const globals = {
  Title: 'fyi-photos',
  RSS: '#',
  Favicon: '',
  Tag: activeTag,
  SearchQuery: '',
  CurrentPage: '1',
  TotalPages: '8',
  NextPage: '/page/2',
  CustomCSS: '',
  CopyrightYears: '2026',
  PostSummary: '',
};
out = out.replace(/\{([A-Za-z][A-Za-z0-9_-]*)\}/g, (m, k) => {
  if (k in globals) return globals[k];
  // skip unrecognised
  return '';
});

fs.writeFileSync(outFile, out);
console.log(`✓ ${outFile} (${pageType})`);
