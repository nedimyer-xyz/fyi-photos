// Push tags from the tagger to Tumblr.
//
//   npm run migrate:plan                       dry run → migration/data/plan.txt
//   npm run migrate:apply -- --only <postId>   edit one post and verify it
//   npm run migrate:apply                      edit every changed post (resumable)
//   npm run migrate:rollback                   restore original tags + alt text
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  BLOG, DATA, POSTS_FILE, TAGS_FILE, APPLIED_FILE,
  readJSON, writeJSON, readConfig, parseAlt, buildAlt, computePostTags, npfImages, sleep,
} from './lib.mjs';
import { api } from './auth.mjs';

const SITE = process.env.FYI_SITE || 'https://fyi.photos';
const DELAY = Number(process.env.APPLY_DELAY_MS || 1100);
const args = process.argv.slice(2);
const mode = args[0] || 'plan';
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameSet = (a, b) => same([...a].sort(), [...b].sort());
const hash = (v) => createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12);

/* ── Desired state ──────────────────────────────────────── */

// For one post: target tags + target alt text per photo key, given its current state.
function desired(current, photoTags, cfg) {
  const lists = current.photos.map((ph) => photoTags[ph.key] || []);
  const tags = computePostTags(current.tags, lists, cfg);
  const alts = {};
  for (const ph of current.photos) alts[ph.key] = buildAlt(ph.alt, photoTags[ph.key] || []);
  return { tags, alts };
}
function currentAlts(post) {
  const out = {};
  for (const ph of post.photos) out[ph.key] = buildAlt(ph.alt, ph.altTags || []);
  return out;
}

/* ── Live posts (NPF) ───────────────────────────────────── */

async function fetchLive(id) {
  const r = await api('GET', `/blog/${BLOG}/posts/${id}`);
  const post = r.post || (r.posts && r.posts[0]) || r;
  if (!Array.isArray(post.content)) throw new Error(`Post ${id} has no NPF content (legacy format?) — edit it manually.`);
  return post;
}

// Shape a live NPF post like an exported post so `desired` can be reused.
function liveSummary(post) {
  return {
    tags: post.tags || [],
    photos: npfImages(post.content).map(({ key, block }) => {
      const a = parseAlt(block.alt_text);
      return { key, alt: a.desc, altTags: a.tags };
    }),
  };
}

async function putPost(post, tags, alts) {
  const content = post.content.map((block) => {
    if (block.type !== 'image') return block;
    const key = npfImages([block])[0]?.key;
    if (!key || !(key in alts)) return block;
    const next = { ...block };
    if (alts[key]) next.alt_text = alts[key];
    else delete next.alt_text;
    return next;
  });
  const body = {
    content,
    layout: post.layout || [],
    tags: tags.join(','),
    date: new Date(post.timestamp * 1000).toISOString(), // keep the original publish date
  };
  if (post.slug) body.slug = post.slug;
  if (post.state && post.state !== 'published') body.state = post.state;
  if (post.interactability_reblog) body.interactability_reblog = post.interactability_reblog;
  await api('PUT', `/blog/${BLOG}/posts/${post.id_string || post.id}`, body);
}

async function verify(id, tags, alts) {
  const live = liveSummary(await fetchLive(id));
  const gotAlts = currentAlts(live);
  const problems = [];
  if (!sameSet(live.tags, tags)) problems.push(`tags are ${live.tags.join(', ')}`);
  for (const k of Object.keys(alts)) if ((gotAlts[k] || '') !== alts[k]) problems.push(`alt for ${k} is "${gotAlts[k]}"`);
  return problems;
}

/* ── Commands ───────────────────────────────────────────── */

async function loadInputs() {
  const exported = await readJSON(POSTS_FILE, null);
  if (!exported) throw new Error('No export found. Run: npm run export');
  const state = await readJSON(TAGS_FILE, null);
  if (!state) throw new Error('No tags yet. Run: npm run tagger');
  return { exported, state, cfg: await readConfig() };
}

async function plan() {
  const { exported, state, cfg } = await loadInputs();
  const lines = [];
  let changed = 0, altChanges = 0;
  const added = {};
  for (const post of exported.posts) {
    const photoTags = state.photos[post.id];
    if (!photoTags) continue;
    const want = desired(post, photoTags, cfg);
    const haveAlts = currentAlts(post);
    const altDiff = post.photos.filter((ph) => haveAlts[ph.key] !== want.alts[ph.key]);
    const tagsChanged = !sameSet(post.tags, want.tags);
    if (!tagsChanged && !altDiff.length) continue;
    changed++;
    altChanges += altDiff.length;
    const plus = want.tags.filter((t) => !post.tags.includes(t));
    const minus = post.tags.filter((t) => !want.tags.includes(t));
    plus.forEach((t) => { added[t] = (added[t] || 0) + 1; });
    lines.push(`POST ${post.id}  ${post.date.slice(0, 10)}  ${post.url}${post.npf ? '' : '  ⚠ legacy format'}`);
    lines.push(`  tags: ${post.tags.join(', ') || '(none)'}`);
    lines.push(`     → ${want.tags.join(', ') || '(none)'}   ${plus.map((t) => '+' + t).concat(minus.map((t) => '-' + t)).join(' ')}`);
    lines.push(`  alt text: ${altDiff.length} of ${post.photos.length} photos change`);
    for (const ph of altDiff) lines.push(`    ${ph.key}  "${haveAlts[ph.key]}" → "${want.alts[ph.key]}"`);
    lines.push('');
  }
  const summary = [
    `${changed} posts will change (${altChanges} photo alt texts).`,
    `Tag additions: ${Object.entries(added).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ×${n}`).join(', ') || 'none'}`,
    `Posts reviewed in tagger: ${Object.keys(state.reviewed || {}).length} / ${exported.posts.length}`,
  ];
  await writeFile(join(DATA, 'plan.txt'), summary.join('\n') + '\n\n' + lines.join('\n'));
  console.log(summary.join('\n'));
  console.log(`Full diff → ${join(DATA, 'plan.txt')}`);
  if (exported.source !== 'api') console.log('Note: this export came from the public feed. `apply` re-reads every post from the API before editing.');
}

async function apply() {
  const { exported, state, cfg } = await loadInputs();
  const applied = await readJSON(APPLIED_FILE, {});
  let ids = exported.posts.map((p) => p.id).filter((id) => state.photos[id]);
  if (only) {
    if (!state.photos[only]) throw new Error(`Post ${only} has no tags in the tagger yet.`);
    ids = [only];
  }
  console.log(`Checking ${ids.length} post${ids.length === 1 ? '' : 's'} against Tumblr…`);
  let done = 0, skipped = 0, failed = 0;
  for (const id of ids) {
    const photoTags = state.photos[id];
    const fingerprint = hash(photoTags);
    if (!only && applied[id]?.fingerprint === fingerprint && applied[id]?.ok) { skipped++; continue; }
    try {
      const live = await fetchLive(id);
      const summary = liveSummary(live);
      const want = desired(summary, photoTags, cfg);
      if (sameSet(summary.tags, want.tags) && same(currentAlts(summary), want.alts)) {
        applied[id] = { ok: true, fingerprint, at: new Date().toISOString(), note: 'already up to date' };
        skipped++;
      } else {
        await sleep(DELAY);
        await putPost(live, want.tags, want.alts);
        await sleep(DELAY);
        const problems = await verify(id, want.tags, want.alts);
        applied[id] = { ok: !problems.length, fingerprint, at: new Date().toISOString(), tags: want.tags, problems };
        if (problems.length) { failed++; console.log(`  ⚠ ${id}: ${problems.join('; ')}`); }
        else { done++; console.log(`  ✓ ${id}  ${want.tags.join(', ')}`); }
      }
    } catch (e) {
      failed++;
      applied[id] = { ok: false, fingerprint, at: new Date().toISOString(), error: e.message };
      console.log(`  ✗ ${id}: ${e.message}`);
      if (e.status === 401) { await writeJSON(APPLIED_FILE, applied); throw new Error('Not authorized. Run: npm run auth'); }
    }
    await writeJSON(APPLIED_FILE, applied);
    await sleep(DELAY);
  }
  console.log(`Done: ${done} updated, ${skipped} unchanged/skipped, ${failed} failed.`);

  if (only && applied[only]?.ok) {
    // Make sure the theme can see the per-photo tags in the rendered page.
    // The public feed returns the same post HTML the theme gets as {Body}, whatever theme is installed.
    const html = (await (await fetch(`${SITE}/api/read/json?id=${only}`)).text()).replace(/\\"/g, '"');
    const ok = /alt="[^"]*\[[^"\]]+\]"/.test(html);
    console.log(ok
      ? `✓ Per-photo tags are visible to the theme (checked ${SITE}/api/read/json?id=${only})`
      : `⚠ Tags were saved, but no "[tags]" alt text was found for post ${only}. Don't run the full apply yet.`);
  }
}

async function rollback() {
  const backups = (await readdir(DATA)).filter((f) => f.startsWith('backup-')).sort();
  if (!backups.length) throw new Error('No backup found in migration/data.');
  const fromArg = args.includes('--from') ? args[args.indexOf('--from') + 1] : null;
  const file = join(DATA, fromArg || backups[0]);
  const backup = await readJSON(file);
  const applied = await readJSON(APPLIED_FILE, {});
  const ids = only ? [only] : Object.keys(applied);
  console.log(`Restoring ${ids.length} posts from ${file}…`);
  for (const id of ids) {
    const orig = backup.posts.find((p) => p.id === id);
    if (!orig) { console.log(`  ? ${id} not in backup, skipped`); continue; }
    try {
      const live = await fetchLive(id);
      const alts = {};
      for (const ph of orig.photos) alts[ph.key] = buildAlt(ph.alt, ph.altTags || []);
      await sleep(DELAY);
      await putPost(live, orig.tags, alts);
      delete applied[id];
      await writeJSON(APPLIED_FILE, applied);
      console.log(`  ↺ ${id}  ${orig.tags.join(', ') || '(no tags)'}`);
    } catch (e) {
      console.log(`  ✗ ${id}: ${e.message}`);
    }
    await sleep(DELAY);
  }
}

const commands = { plan, apply, rollback };
if (!commands[mode]) {
  console.error('Usage: node migration/apply.mjs plan | apply [--only <postId>] | rollback [--only <postId>] [--from <backup file>]');
  process.exit(1);
}
commands[mode]().catch((e) => { console.error('✗', e.message); process.exit(1); });
