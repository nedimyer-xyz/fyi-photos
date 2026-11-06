// Admin storage: a small versioned JSON document (lists, reviewed flags, theme
// status) plus temporary photo uploads. Uses Vercel Blob in production and a
// local folder in development (when BLOB_READ_WRITE_TOKEN is not set).
//
// Every save writes a new store/<timestamp>-<rand>.json, so reads never hit a
// stale CDN copy. data.configRev changes only when the lists change; list edits
// must send the configRev they were based on, so an out-of-date tab can't
// overwrite newer lists (reviewed marks and theme status never conflict).
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig, injectConfig, CATEGORIES, slug } from '../shared/core.mjs';

const THEME_URL = new URL('../theme.html', import.meta.url);
const KEEP = 20;
const useBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const LOCAL = () => process.env.ADMIN_DATA_DIR || fileURLToPath(new URL('../.admin-data/', import.meta.url));

export class Conflict extends Error {
  constructor() {
    super('Changed in another tab — reload to continue.');
    this.status = 409;
  }
}

async function blob() {
  return import('@vercel/blob');
}

/* ── Theme template ─────────────────────────────────────── */

let templateCache = null;
export async function themeTemplate() {
  if (!templateCache) templateCache = await readFile(THEME_URL, 'utf8');
  return templateCache;
}

export async function buildTheme(config) {
  return injectConfig(await themeTemplate(), config);
}

export function hash(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

/* ── Store document ─────────────────────────────────────── */

async function listDocs() {
  if (useBlob()) {
    const { list } = await blob();
    const out = [];
    let cursor;
    do {
      const r = await list({ prefix: 'store/', cursor, limit: 1000 });
      out.push(...r.blobs.map((b) => ({ name: b.pathname.slice('store/'.length), url: b.url })));
      cursor = r.hasMore ? r.cursor : null;
    } while (cursor);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  const dir = join(LOCAL(), 'store');
  await mkdir(dir, { recursive: true });
  return (await readdir(dir)).filter((n) => n.endsWith('.json')).sort().map((name) => ({ name, path: join(dir, name) }));
}

async function readDoc(d) {
  if (d.url) {
    const res = await fetch(d.url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Store read failed (${res.status})`);
    return res.json();
  }
  return JSON.parse(await readFile(d.path, 'utf8'));
}

async function writeDoc(data) {
  const name = `${String(Date.now()).padStart(13, '0')}-${randomBytes(4).toString('hex')}.json`;
  const body = JSON.stringify(data);
  if (useBlob()) {
    const { put } = await blob();
    await put(`store/${name}`, body, {
      access: 'public', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 60,
    });
  } else {
    const dir = join(LOCAL(), 'store');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), body);
  }
  return name;
}

async function prune(docs) {
  const old = docs.slice(0, Math.max(0, docs.length - KEEP));
  if (!old.length) return;
  if (useBlob()) {
    const { del } = await blob();
    await del(old.map((d) => d.url));
  } else {
    await Promise.all(old.map((d) => rm(d.path, { force: true })));
  }
}

export function normalizeConfig(cfg) {
  const out = {};
  for (const cat of CATEGORIES) {
    const seen = new Set();
    out[cat] = (Array.isArray(cfg?.[cat]) ? cfg[cat] : []).map((e) => {
      const tag = slug(e && e.tag);
      const label = String((e && e.label) || '').trim().slice(0, 80);
      if (!tag || !label || seen.has(tag)) return null;
      seen.add(tag);
      const entry = { tag, label };
      if (cat !== 'people') {
        const cover = String(e.cover || '');
        entry.cover = /^https:\/\/\d+\.media\.tumblr\.com\//.test(cover) ? cover : '';
      }
      return entry;
    }).filter(Boolean);
  }
  // A tag can only belong to one category.
  const owner = {};
  for (const cat of CATEGORIES) for (const e of out[cat]) {
    if (owner[e.tag]) throw Object.assign(new Error(`"${e.tag}" is already in ${owner[e.tag]}`), { status: 400 });
    owner[e.tag] = cat;
  }
  return out;
}

async function seed() {
  return { config: normalizeConfig(parseConfig(await themeTemplate())), configRev: 'seed', reviewed: {}, themeCopied: '' };
}

export async function readStore() {
  const docs = await listDocs();
  if (!docs.length) {
    const data = await seed();
    const rev = await writeDoc(data);
    return { rev, data };
  }
  const latest = docs[docs.length - 1];
  const data = await readDoc(latest);
  data.configRev = data.configRev || 'seed';
  return { rev: latest.name, data };
}

// mutate(data) returns the new data. Pass baseConfigRev for list edits: throws
// Conflict if the lists changed since that revision.
export async function updateStore(baseConfigRev, mutate) {
  const docs = await listDocs();
  const latest = docs[docs.length - 1];
  const current = latest ? await readDoc(latest) : await seed();
  current.configRev = current.configRev || 'seed';
  if (baseConfigRev && baseConfigRev !== current.configRev) throw new Conflict();
  const data = await mutate(structuredClone(current));
  if (baseConfigRev) data.configRev = randomBytes(6).toString('hex');
  const rev = await writeDoc(data);
  prune([...docs, { name: rev }].filter((d) => d.name !== rev)).catch(() => {});
  return { rev, data };
}

export async function themeStatus(data) {
  const text = await buildTheme(data.config);
  const h = hash(text);
  return { hash: h, upToDate: data.themeCopied === h };
}

/* ── Staged photo uploads ───────────────────────────────── */

export async function stagePhoto(bytes, type) {
  const name = `uploads/${Date.now()}-${randomBytes(8).toString('hex')}.jpg`;
  if (useBlob()) {
    const { put } = await blob();
    const r = await put(name, bytes, { access: 'public', contentType: type, addRandomSuffix: false });
    return r.url;
  }
  const path = join(LOCAL(), name);
  await mkdir(join(LOCAL(), 'uploads'), { recursive: true });
  await writeFile(path, Buffer.from(bytes));
  return `local:${name}`;
}

function checkStaged(ref) {
  if (useBlob()) {
    const u = new URL(ref);
    if (!/\.public\.blob\.vercel-storage\.com$/.test(u.hostname) || !u.pathname.startsWith('/uploads/')) {
      throw Object.assign(new Error('Invalid upload reference'), { status: 400 });
    }
  } else if (!/^local:uploads\/[\w-]+\.jpg$/.test(ref)) {
    throw Object.assign(new Error('Invalid upload reference'), { status: 400 });
  }
}

export async function readStaged(ref) {
  checkStaged(ref);
  if (useBlob()) {
    const res = await fetch(ref);
    if (!res.ok) throw new Error(`Upload missing (${res.status}) — please re-add that photo`);
    return new Uint8Array(await res.arrayBuffer());
  }
  return new Uint8Array(await readFile(join(LOCAL(), ref.slice('local:'.length))));
}

export async function deleteStaged(refs) {
  const valid = refs.filter((r) => { try { checkStaged(r); return true; } catch { return false; } });
  if (!valid.length) return;
  if (useBlob()) {
    const { del } = await blob();
    await del(valid);
  } else {
    await Promise.all(valid.map((r) => rm(join(LOCAL(), r.slice('local:'.length)), { force: true })));
  }
}

// Remove uploads left behind by abandoned drafts (older than a day).
export async function cleanupOldStaged(maxAgeMs = 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  if (useBlob()) {
    const { list, del } = await blob();
    const r = await list({ prefix: 'uploads/', limit: 1000 });
    const old = r.blobs.filter((b) => new Date(b.uploadedAt).getTime() < cutoff).map((b) => b.url);
    if (old.length) await del(old);
    return old.length;
  }
  const dir = join(LOCAL(), 'uploads');
  const { stat } = await import('node:fs/promises');
  let n = 0;
  for (const name of await readdir(dir).catch(() => [])) {
    const p = join(dir, name);
    if ((await stat(p)).mtimeMs < cutoff) { await rm(p, { force: true }); n++; }
  }
  return n;
}
