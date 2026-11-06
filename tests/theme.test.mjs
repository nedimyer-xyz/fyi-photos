import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script, runInNewContext } from 'node:vm';
import { injectConfig, parseConfig } from '../shared/core.mjs';
import { buildTheme } from '../server/store.mjs';

const template = await readFile(new URL('../theme.html', import.meta.url), 'utf8');

test('admin theme export changes only lists and preserves design features', async () => {
  const config = parseConfig(template);
  config.people.push({ tag: 'new-person', label: 'New Person' });
  config.travel.push({ tag: 'new-place', label: 'New Place', cover: '' });
  const output = await buildTheme(config);
  assert.deepEqual(parseConfig(output), config);
  assert.equal(injectConfig(output, {}), injectConfig(template, {}));
  assert.match(output, /class="lb-tags"/);
  assert.match(output, /function renderLbTags/);
  assert.match(output, /\.lb-tags \{[^}]*justify-content: flex-start/);
  assert.match(output, /function fillSkeletonGrid/);
  assert.match(output, /Math\.min\.apply\(null, heights\) - gap < targetHeight/);
  assert.match(output, /g\.classList\.add\('grid--masonry'\)/);
  assert.doesNotMatch(output, /googletagmanager|gtag\(/);
  assert.match(output, /admin\.fyi\.photos\/api\/analytics/);
  assert.match(output, /navigator\.doNotTrack === '1'/);
  assert.match(output, /credentials: 'omit'/);
  assert.doesNotMatch(output, /sendBeacon/);
  for (const [, script] of output.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    new Script(script);
  }
});

test('each copy downloads a fresh theme and marks only that exact export', async () => {
  const app = await readFile(new URL('../admin/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('    function paintBanner()');
  const end = app.indexOf('    /*', start);
  assert.ok(start >= 0 && end > start);
  let click, downloads = 0, fail = false;
  const copied = [], marked = [], messages = [];
  const button = { disabled: false, addEventListener: (_, handler) => { click = handler; } };
  runInNewContext(app.slice(start, end), {
    store: { theme: { upToDate: false } },
    $: (id) => id === 'btn-copy-theme' ? button : {},
    api: async () => {
      downloads++;
      return { ok: !fail, status: fail ? 500 : 200,
        headers: { get: () => 'hash-' + downloads }, text: async () => 'theme-' + downloads };
    },
    apiJSON: async (_, __, body) => {
      marked.push(body.hash);
      return { theme: { upToDate: true } };
    },
    queued: (job) => job(),
    navigator: { clipboard: { writeText: async (text) => { copied.push(text); } } },
    toast: (message) => messages.push(message),
  });
  async function copy() {
    click.call(button);
    assert.equal(button.disabled, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(button.disabled, false);
  }
  await copy();
  await copy();
  assert.equal(downloads, 2);
  assert.deepEqual(copied, ['theme-1', 'theme-2']);
  assert.deepEqual(marked, ['hash-1', 'hash-2']);
  fail = true;
  await copy();
  assert.equal(copied.length, 2);
  assert.equal(marked.length, 2);
  assert.match(messages.at(-1), /Theme download failed \(500\)/);
});
