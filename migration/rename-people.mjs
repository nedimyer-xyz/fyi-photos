// Rename / merge people everywhere from migration/data/people-names.md.
//
//   npm run rename-people            dry run: shows what would change
//   npm run rename-people -- --write apply to theme CONFIG + tags.json
//
// Each list line is "- <current tag> (<count>): <Full Name>". A changed name
// gets a new tag (slug of the name); two lines with the same name are merged.
import { readFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA, TAGS_FILE, readJSON, writeJSON, readConfig, writeConfig, slug, uniq } from './lib.mjs';

const FILE = process.env.PEOPLE_FILE || join(DATA, 'people-names.md');
const WRITE = process.argv.includes('--write');

const cfg = await readConfig();
const state = await readJSON(TAGS_FILE, null);
if (!state) throw new Error('No tags.json found.');
const byTag = new Map(cfg.people.map((p) => [p.tag, p]));
const otherTags = new Set([...cfg.travel, ...cfg.series].map((e) => e.tag).concat(['people', 'travel', 'series']));

// Markdown editors may escape characters; undo the common ones.
const unescape = (s) => s.replace(/\\([\\`*_{}\[\]()#+\-.!'])/g, '$1').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');

const renames = new Map(); // old tag → { tag, label }
const problems = [];
for (const raw of (await readFile(FILE, 'utf8')).split('\n')) {
  const m = raw.match(/^\s*[-*]\s+(.+?)\s*\(\d+\)\s*:\s*(.*?)\s*$/);
  if (!m) continue;
  const oldTag = unescape(m[1]).trim();
  const label = unescape(m[2]).replace(/\s+/g, ' ').trim();
  const entry = byTag.get(oldTag);
  if (!entry) { problems.push(`Unknown tag "${oldTag}" (was the left side edited?)`); continue; }
  if (!label || label === entry.label) continue;
  const tag = slug(label);
  if (!tag) { problems.push(`"${label}" doesn't make a usable tag`); continue; }
  if (otherTags.has(tag)) { problems.push(`"${label}" clashes with an existing travel/series tag`); continue; }
  renames.set(oldTag, { tag, label });
}

// A kept name that someone else is renamed into → that's a merge, keep its label.
const finalOf = (t) => renames.get(t) || { tag: t, label: byTag.get(t).label };
const groups = new Map();
for (const p of cfg.people) {
  const f = finalOf(p.tag);
  if (!groups.has(f.tag)) groups.set(f.tag, { ...f, from: [] });
  groups.get(f.tag).from.push(p.tag);
}
for (const g of groups.values()) {
  const labels = uniq(g.from.map((t) => finalOf(t).label));
  if (labels.length > 1) problems.push(`Merging into "${g.tag}" with different names: ${labels.join(' / ')}`);
}

if (problems.length) {
  console.log('Please fix these in people-names.md:\n  ' + problems.join('\n  '));
  process.exit(1);
}

// Report
const lines = [];
for (const g of groups.values()) {
  const changed = g.from.length > 1 || g.from[0] !== g.tag || byTag.get(g.from[0]).label !== g.label;
  if (!changed) continue;
  lines.push(g.from.length > 1
    ? `  merge  ${g.from.join(' + ')}  →  ${g.tag}  (${g.label})`
    : `  rename ${g.from[0]}  →  ${g.tag}  (${g.label})`);
}
if (!lines.length) { console.log('No changes found in people-names.md.'); process.exit(0); }
console.log(`${lines.length} change${lines.length === 1 ? '' : 's'}:\n` + lines.join('\n'));

// Photo tags
const map = new Map([...renames].map(([o, n]) => [o, n.tag]));
let touched = 0;
for (const post of Object.values(state.photos)) {
  for (const key of Object.keys(post)) {
    const before = post[key];
    const after = uniq(before.map((t) => map.get(t) || t)).sort();
    if (JSON.stringify(before) !== JSON.stringify(after)) { post[key] = after; touched++; }
  }
}
console.log(`${touched} photos will get updated tags.`);

if (!WRITE) {
  console.log('\nDry run only. Run again with --write to apply.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await copyFile(TAGS_FILE, join(DATA, `tags-before-rename-${stamp}.json`));
cfg.people = [...groups.values()].map((g) => ({ tag: g.tag, label: g.label }));
await writeConfig(cfg);
await writeJSON(TAGS_FILE, { ...state, savedAt: new Date().toISOString() });
console.log(`✓ Updated theme.html CONFIG and tags.json (backup: tags-before-rename-${stamp}.json)`);
