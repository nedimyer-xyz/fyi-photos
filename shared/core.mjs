// Pure helpers shared by the local scripts (migration/) and the admin site (api/, server/).
// No Node-only imports here.

export const CATEGORIES = ['people', 'travel', 'series'];

/* ── Photos ─────────────────────────────────────────────── */

// Stable id for a Tumblr image regardless of rendition size:
// https://64.media.tumblr.com/<hash>/<id>/s640x960/…  →  "<hash>/<id>"
export function photoKey(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts.length >= 2 ? parts[0] + '/' + parts[1] : null;
  } catch {
    return null;
  }
}

// Same convention the theme uses: "Optional description [tag-a, tag-b]".
const BRACKET = /\s*\[([^\[\]]*)\]\s*$/;
export function parseAlt(alt) {
  let text = String(alt || '').trim();
  if (text.toLowerCase() === 'image') text = '';
  const m = text.match(BRACKET);
  if (!m) return { desc: text, tags: [] };
  return { desc: text.slice(0, m.index).trim(), tags: splitTags(m[1]) };
}
export function buildAlt(desc, tags) {
  const t = uniq(tags.map(slug)).sort();
  const d = String(desc || '').trim();
  if (!t.length) return d;
  return (d ? d + ' ' : '') + '[' + t.join(', ') + ']';
}

export function slug(s) {
  return String(s || '').toLowerCase().trim().replace(/[\s_]+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '');
}
export function splitTags(s) {
  return uniq(String(s || '').split(',').map(slug).filter(Boolean));
}
export function uniq(a) {
  return [...new Set(a)];
}

/* ── Theme CONFIG ───────────────────────────────────────── */

const CONFIG_RE = /(var CONFIG = )(\{[\s\S]*?\n {8}\});/;

export function parseConfig(html) {
  const m = html.match(CONFIG_RE);
  if (!m) throw new Error('Could not find "var CONFIG = {…};" in theme.html');
  // eslint-disable-next-line no-new-func
  return new Function('return ' + m[2])();
}

function q(s) {
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}
export function formatConfig(cfg) {
  const pad = ' '.repeat(12);
  const groups = CATEGORIES.map((cat) => {
    const list = cfg[cat] || [];
    const tw = Math.max(0, ...list.map((e) => q(e.tag).length)) + 1;
    const lw = Math.max(0, ...list.map((e) => q(e.label).length)) + 1;
    const rows = list.map((e) => {
      const tag = (q(e.tag) + ',').padEnd(tw);
      if (cat === 'people') return `${pad}    { tag: ${tag} label: ${q(e.label)} }`;
      const label = (q(e.label) + ',').padEnd(lw);
      return `${pad}    { tag: ${tag} label: ${label} cover: ${q(e.cover || '')} }`;
    });
    return `${pad}${cat}: [\n${rows.join(',\n')}\n${pad}]`;
  });
  return '{\n' + groups.join(',\n') + '\n' + ' '.repeat(8) + '}';
}

export function injectConfig(html, cfg) {
  if (!CONFIG_RE.test(html)) throw new Error('Could not find CONFIG in theme.html');
  return html.replace(CONFIG_RE, (_, pre) => pre + formatConfig(cfg) + ';');
}

export function managedTags(cfg) {
  const set = new Set(CATEGORIES);
  for (const cat of CATEGORIES) for (const e of cfg[cat] || []) set.add(slug(e.tag));
  return set;
}
export function categoryOf(cfg, tag) {
  const t = slug(tag);
  if (CATEGORIES.includes(t)) return t;
  for (const cat of CATEGORIES) if ((cfg[cat] || []).some((e) => slug(e.tag) === t)) return cat;
  return null;
}

// Post tags = original unmanaged tags + every photo tag + their categories.
export function computePostTags(originalTags, photoTagLists, cfg) {
  const managed = managedTags(cfg);
  const keep = originalTags.filter((t) => !managed.has(slug(t)));
  const add = new Set();
  for (const list of photoTagLists) {
    for (const t of list) {
      add.add(t);
      const c = categoryOf(cfg, t);
      if (c) add.add(c);
    }
  }
  const ordered = [...CATEGORIES.filter((c) => add.has(c)), ...[...add].filter((t) => !CATEGORIES.includes(t)).sort()];
  return uniq([...keep, ...ordered]);
}

/* ── NPF helpers ────────────────────────────────────────── */

// Image blocks in a post's NPF content → [{ key, index, block }]
export function npfImages(content) {
  const out = [];
  (content || []).forEach((block, index) => {
    if (block.type !== 'image' || !Array.isArray(block.media) || !block.media.length) return;
    const key = photoKey(block.media[0].url);
    if (key) out.push({ key, index, block });
  });
  return out;
}

export function pickSize(media, target) {
  const sorted = [...media].filter((m) => m.width).sort((a, b) => a.width - b.width);
  return (sorted.find((m) => m.width >= target) || sorted[sorted.length - 1] || media[0]).url;
}
