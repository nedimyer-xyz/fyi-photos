import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  cleanCountry,
  cleanPath,
  cleanReferrer,
  eventFromRequest,
  parseEventPath,
  readEvents,
  recordEvent,
  summarize,
} from '../server/analytics.mjs';
import { OPTIONS as collectOptions, POST as collect } from '../api/analytics.js';

process.env.SESSION_SECRET = 'analytics-test-secret-that-is-long-enough';
process.env.ANALYTICS_LOCAL = '1';

function request(headers = {}) {
  return new Request('https://admin.fyi.photos/api/analytics', { headers });
}

test('analytics sanitizes fields and never includes a raw IP or user agent', () => {
  assert.equal(cleanPath('/tagged/people?secret=yes#top'), '/tagged/people');
  assert.equal(cleanPath('info'), '/info');
  assert.equal(cleanReferrer('www.Instagram.com'), 'instagram.com');
  assert.equal(cleanReferrer('javascript:alert(1)'), 'Direct');
  assert.equal(cleanCountry('us'), 'US');
  const event = eventFromRequest(request({
    'x-forwarded-for': '203.0.113.42, 10.0.0.1',
    'user-agent': 'Private Browser 1',
    'x-vercel-ip-country': 'US',
  }), { path: '/tagged/japan?x=1', referrer: 'google.com' }, new Date('2026-10-31T12:00:00Z'));
  assert.deepEqual(Object.keys(event).sort(), ['country', 'day', 'path', 'referrer', 'time', 'visitor']);
  assert.equal(event.path, '/tagged/japan');
  assert.equal(event.country, 'US');
  assert.equal(event.visitor.length, 16);
  assert.doesNotMatch(JSON.stringify(event), /203\.0\.113\.42|Private Browser/);
});

test('analytics event path round trips only privacy-safe fields', () => {
  const pathname = [
    'analytics/events/2026-10-31',
    'mhf5ao00~abcdef123456~1234567890abcdef~CA~L3RhZ2dlZC9pdGFseQ~aW5zdGFncmFtLmNvbQ',
  ].join('/');
  assert.deepEqual(parseEventPath(pathname), {
    day: '2026-10-31',
    time: parseInt('mhf5ao00', 36),
    visitor: '1234567890abcdef',
    country: 'CA',
    path: '/tagged/italy',
    referrer: 'instagram.com',
  });
});

test('analytics summarizes daily visitors, pageviews, sources, countries, and pages', () => {
  const events = [
    { day: '2026-10-31', time: Date.parse('2026-10-31T08:00:00Z'), visitor: 'a', path: '/', referrer: 'Direct', country: 'US' },
    { day: '2026-10-31', time: Date.parse('2026-10-31T08:20:00Z'), visitor: 'a', path: '/info', referrer: 'Direct', country: 'US' },
    { day: '2026-10-31', time: Date.parse('2026-10-31T18:00:00Z'), visitor: 'b', path: '/', referrer: 'instagram.com', country: 'CA' },
    { day: '2026-10-30', time: Date.parse('2026-10-30T12:00:00Z'), visitor: 'a', path: '/', referrer: 'google.com', country: 'US' },
    { day: '2026-09-01', visitor: 'old', path: '/', referrer: 'Direct', country: 'US' },
  ];
  const result = summarize(events, 7, new Date('2026-10-31T18:00:00Z'));
  assert.deepEqual(result.totals, { visitors: 3, pageviews: 4, dailyAverage: 0.4 });
  assert.equal(result.chart.length, 7);
  assert.deepEqual(result.pages[0], { name: '/', count: 3 });
  assert.deepEqual(result.countries[0], { name: 'US', count: 3 });
  assert.deepEqual(result.referrals.map((row) => row.name), ['Direct', 'google.com', 'instagram.com']);
  const today = summarize(events, 1, new Date('2026-10-31T18:00:00Z'));
  assert.equal(today.chart.length, 24);
  assert.deepEqual(today.chart[8], { key: '08', label: '8am', visitors: 1, pageviews: 2 });
  assert.deepEqual(today.chart[18], { key: '18', label: '6pm', visitors: 1, pageviews: 1 });
});

test('local analytics storage is separate and contains no raw request identifiers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fyi-analytics-'));
  process.env.ADMIN_DATA_DIR = dir;
  try {
    const event = eventFromRequest(request({
      'x-forwarded-for': '198.51.100.9',
      'user-agent': 'Test Browser',
      'x-vercel-ip-country': 'GB',
    }), { path: '/info', referrer: 'example.com' }, new Date());
    assert.equal((await recordEvent(event)).recorded, true);
    const stored = await readEvents();
    assert.equal(stored.length, 1);
    const root = join(dir, 'analytics', 'events', event.day);
    const names = await readdir(root);
    assert.equal(names.length, 1);
    assert.doesNotMatch(names[0], /198\.51\.100\.9|Test Browser/);
    assert.equal(await readFile(join(root, names[0]), 'utf8'), '1');
    assert.deepEqual(await readdir(join(dir, 'analytics')), ['events']);
  } finally {
    await rm(dir, { recursive: true, force: true });
    delete process.env.ADMIN_DATA_DIR;
  }
});

test('collector accepts only the photo site and rejects bots or malformed payloads cheaply', async () => {
  const make = (origin, body, userAgent = 'Browser') => new Request('https://admin.fyi.photos/api/analytics', {
    method: 'POST',
    headers: { origin, 'content-type': 'text/plain', 'user-agent': userAgent },
    body,
  });
  assert.equal((await collect(make('https://evil.example', '{}'))).status, 403);
  assert.equal((await collectOptions(new Request('https://admin.fyi.photos/api/analytics', {
    method: 'OPTIONS', headers: { origin: 'https://fyi.photos' },
  }))).status, 204);
  assert.equal((await collect(make('https://fyi.photos', '{bad'))).status, 400);
  assert.equal((await collect(make('https://fyi.photos', '{}', 'ExampleBot/1.0'))).status, 202);
});
