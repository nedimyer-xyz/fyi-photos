import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('admin routes separate categories without changing stored tag names', async () => {
  const source = await readFile(new URL('../admin/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('    function setView(v)');
  const end = source.indexOf('    /*', start);
  assert.ok(start > 0 && end > start);
  function element(attributes = {}) {
    return {
      attributes, hidden: false, active: false,
      getAttribute(name) { return this.attributes[name]; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      classList: { toggle(name, active) { attributes[name] = active; } },
    };
  }
  const tabs = ['new', 'tag', 'analytics', 'people', 'places', 'series'].map((route) => element({ 'data-route': route }));
  const views = ['new', 'tag', 'analytics', 'lists'].map((view) => element({ 'data-view': view }));
  const categories = ['people', 'travel', 'series'].map((category) => element({ 'data-category': category }));
  const title = {};
  let hashListener, renders = 0, analyticsLoads = 0;
  const context = {
    store: { config: { people: [], travel: [], series: [] } },
    view: 'new',
    document: { querySelectorAll: (selector) => ({ '.tab': tabs, '.view': views, '[data-category]': categories })[selector] },
    $: (id) => {
      assert.equal(id, 'view-title');
      return title;
    },
    history: { replaceState: (_, __, hash) => { context.location.hash = hash; } },
    location: { hash: '#new' },
    window: { addEventListener: (_, fn) => { hashListener = fn; } },
    renderLists: () => { renders++; },
    loadAnalytics: () => { analyticsLoads++; },
  };
  runInNewContext(source.slice(start, end), context);
  for (const [route, category, heading] of [
    ['people', 'people', 'People'], ['places', 'travel', 'Places'], ['series', 'series', 'Series'],
  ]) {
    context.setView(route);
    assert.equal(context.view, 'lists');
    assert.equal(title.textContent, heading);
    assert.deepEqual(categories.filter((c) => !c.hidden).map((c) => c.attributes['data-category']), [category]);
    assert.equal(tabs.filter((t) => t.attributes['aria-current'] === 'page').length, 1);
  }
  context.setView('lists');
  assert.equal(context.location.hash, '#places');
  context.location.hash = '#tag';
  hashListener();
  assert.equal(context.view, 'tag');
  assert.equal(title.textContent, 'Photo library');
  context.setView('analytics');
  assert.equal(context.view, 'analytics');
  assert.equal(title.textContent, 'Analytics');
  assert.equal(analyticsLoads, 1);
  context.setView('invalid');
  assert.equal(context.view, 'new');
  assert.equal(context.location.hash, '#new');
  assert.equal(renders, 4);
  assert.deepEqual(Object.keys(context.store.config), ['people', 'travel', 'series']);
});
