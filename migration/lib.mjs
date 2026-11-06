// Shared helpers for the retagging tools.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DIR = join(ROOT, 'migration');
export const DATA = join(DIR, 'data');
export const THEME = join(ROOT, 'theme.html');
export const SECRETS = join(DIR, '.secrets.json');
export const POSTS_FILE = join(DATA, 'posts.json');
export const TAGS_FILE = join(DATA, 'tags.json');
export const APPLIED_FILE = join(DATA, 'applied.json');
export const BLOG = process.env.FYI_BLOG || 'fyi-photos';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function readJSON(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(await readFile(file, 'utf8'));
}

// Atomic write so an interrupted save never leaves a half-written file.
export async function writeJSON(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await writeFile(tmp, JSON.stringify(value, null, 1));
  await rename(tmp, file);
}

export * from '../shared/core.mjs';
import { parseConfig, injectConfig } from '../shared/core.mjs';

export async function readConfig() {
  return parseConfig(await readFile(THEME, 'utf8'));
}

export async function writeConfig(cfg) {
  await writeFile(THEME, injectConfig(await readFile(THEME, 'utf8'), cfg));
}
