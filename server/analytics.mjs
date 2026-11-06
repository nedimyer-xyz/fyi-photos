// Privacy-first analytics stored separately from blog/admin data.
// IP addresses and user agents are used only to create a daily rotating hash;
// neither value is written to storage.
import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RETENTION_DAYS = 30;
export const DAILY_EVENT_LIMIT = 1000;
const PREFIX = 'analytics/events/';
const LOCAL = () => process.env.ADMIN_DATA_DIR || fileURLToPath(new URL('../.admin-data/', import.meta.url));
const useBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN && process.env.ANALYTICS_LOCAL !== '1';
const dayCounts = new Map();
const minuteRates = new Map();
let lastPruneDay = '';

function dayOf(date) {
  return date.toISOString().slice(0, 10);
}

function daysAgo(n, now = new Date()) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - n);
  return dayOf(date);
}

function secret() {
  const value = process.env.ANALYTICS_SECRET || process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error('SESSION_SECRET must be set (32+ chars)');
  return value;
}

function encode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value) {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

export function cleanPath(value) {
  let path = String(value || '/').split(/[?#]/)[0].replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!path.startsWith('/')) path = '/' + path;
  path = path.replace(/\/{2,}/g, '/');
  return path.slice(0, 180) || '/';
}

export function cleanReferrer(value) {
  const ref = String(value || '').trim().toLowerCase().replace(/^www\./, '');
  if (!ref || ref === 'direct' || ref === 'fyi.photos') return 'Direct';
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,62}\.)+)[a-z]{2,63}$/.test(ref)) return 'Direct';
  return ref.slice(0, 100);
}

export function cleanCountry(value) {
  const country = String(value || '').toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : 'ZZ';
}

function clientIp(req) {
  return (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '').split(',')[0].trim();
}

export function dailyVisitor(req, day) {
  const raw = [day, clientIp(req), req.headers.get('user-agent') || ''].join('|');
  return createHmac('sha256', secret()).update(raw).digest('hex').slice(0, 16);
}

export function eventFromRequest(req, payload, now = new Date()) {
  const day = dayOf(now);
  return {
    day,
    time: now.getTime(),
    visitor: dailyVisitor(req, day),
    path: cleanPath(payload && payload.path),
    referrer: cleanReferrer(payload && payload.referrer),
    country: cleanCountry(req.headers.get('x-vercel-ip-country') || req.headers.get('cf-ipcountry')),
  };
}

function filename(event) {
  return [
    event.time.toString(36),
    randomBytes(6).toString('hex'),
    event.visitor,
    event.country,
    encode(event.path),
    encode(event.referrer),
  ].join('~');
}

export function parseEventPath(pathname) {
  const parts = pathname.split('/');
  if (parts.length !== 4 || parts[0] !== 'analytics' || parts[1] !== 'events') return null;
  const fields = parts[3].split('~');
  if (fields.length !== 6 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[2])) return null;
  const time = parseInt(fields[0], 36);
  if (!Number.isFinite(time)) return null;
  return {
    day: parts[2],
    time,
    visitor: /^[a-f0-9]{16}$/.test(fields[2]) ? fields[2] : '',
    country: cleanCountry(fields[3]),
    path: cleanPath(decode(fields[4])),
    referrer: cleanReferrer(decode(fields[5])),
  };
}

function allowRate(event) {
  const minute = Math.floor(event.time / 60_000);
  const key = event.visitor + ':' + minute;
  const count = (minuteRates.get(key) || 0) + 1;
  minuteRates.set(key, count);
  if (minuteRates.size > 2000) {
    for (const old of minuteRates.keys()) {
      if (+old.slice(old.lastIndexOf(':') + 1) < minute - 2) minuteRates.delete(old);
    }
  }
  return count <= 10;
}

async function countDay(day) {
  if (dayCounts.has(day)) return dayCounts.get(day);
  let count = 0;
  if (useBlob()) {
    const { list } = await import('@vercel/blob');
    const result = await list({ prefix: PREFIX + day + '/', limit: DAILY_EVENT_LIMIT });
    count = result.blobs.length;
  } else {
    count = (await readdir(join(LOCAL(), PREFIX, day)).catch(() => [])).length;
  }
  dayCounts.set(day, count);
  return count;
}

export async function recordEvent(event) {
  if (!allowRate(event)) return { recorded: false, reason: 'rate' };
  const count = await countDay(event.day);
  if (count >= DAILY_EVENT_LIMIT) return { recorded: false, reason: 'limit' };
  const name = filename(event);
  if (useBlob()) {
    const { put } = await import('@vercel/blob');
    await put(PREFIX + event.day + '/' + name, '1', {
      access: 'public',
      contentType: 'text/plain',
      addRandomSuffix: false,
      cacheControlMaxAge: 31_536_000,
    });
  } else {
    const dir = join(LOCAL(), PREFIX, event.day);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), '1');
  }
  dayCounts.set(event.day, count + 1);
  return { recorded: true };
}

async function listBlobPaths() {
  const { list } = await import('@vercel/blob');
  const paths = [];
  let cursor;
  do {
    const result = await list({ prefix: PREFIX, cursor, limit: 1000 });
    paths.push(...result.blobs.map((blob) => ({ pathname: blob.pathname, url: blob.url })));
    cursor = result.hasMore ? result.cursor : null;
  } while (cursor);
  return paths;
}

async function pruneBlobRecords(records, oldest) {
  const old = records.filter((record) => {
    const event = parseEventPath(record.pathname);
    return !event || event.day < oldest;
  });
  if (old.length) {
    const { del } = await import('@vercel/blob');
    await del(old.map((record) => record.url));
  }
}

export async function pruneAnalytics(now = new Date()) {
  const today = dayOf(now);
  if (lastPruneDay === today) return;
  const oldest = daysAgo(RETENTION_DAYS - 1, now);
  if (useBlob()) {
    await pruneBlobRecords(await listBlobPaths(), oldest);
  } else {
    const root = join(LOCAL(), PREFIX);
    for (const day of await readdir(root).catch(() => [])) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < oldest) {
        await rm(join(root, day), { recursive: true, force: true });
      }
    }
  }
  for (const day of dayCounts.keys()) if (day < oldest) dayCounts.delete(day);
  lastPruneDay = today;
}

export async function readEvents(now = new Date()) {
  const oldest = daysAgo(RETENTION_DAYS - 1, now);
  if (useBlob()) {
    const records = await listBlobPaths();
    if (lastPruneDay !== dayOf(now)) {
      await pruneBlobRecords(records, oldest);
      lastPruneDay = dayOf(now);
    }
    return records.map((record) => parseEventPath(record.pathname))
      .filter((event) => event && event.day >= oldest);
  }
  await pruneAnalytics(now);
  const root = join(LOCAL(), PREFIX);
  const events = [];
  for (const day of await readdir(root).catch(() => [])) {
    if (day < oldest || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    for (const name of await readdir(join(root, day)).catch(() => [])) {
      const event = parseEventPath(PREFIX + day + '/' + name);
      if (event) events.push(event);
    }
  }
  return events;
}

function ranked(events, key, fallback) {
  const counts = new Map();
  for (const event of events) {
    const value = event[key] || fallback;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8);
}

export function summarize(events, days, now = new Date()) {
  const period = [1, 7, 30].includes(days) ? days : 7;
  const start = daysAgo(period - 1, now);
  const relevant = events.filter((event) => event.day >= start && event.day <= dayOf(now));
  const daily = new Map();
  for (let i = period - 1; i >= 0; i--) {
    const day = daysAgo(i, now);
    daily.set(day, { key: day, visitors: new Set(), pageviews: 0 });
  }
  for (const event of relevant) {
    const row = daily.get(event.day);
    if (!row) continue;
    row.pageviews++;
    if (event.visitor) row.visitors.add(event.visitor);
  }
  const dailyChart = [...daily.values()].map((row) => ({
    key: row.key,
    visitors: row.visitors.size,
    pageviews: row.pageviews,
  }));
  const visitors = dailyChart.reduce((sum, row) => sum + row.visitors, 0);
  const pageviews = relevant.length;
  let chart = dailyChart;
  if (period === 1) {
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      key: String(hour).padStart(2, '0'),
      label: hour === 0 ? '12am' : hour < 12 ? hour + 'am' : hour === 12 ? '12pm' : (hour - 12) + 'pm',
      visitors: new Set(),
      pageviews: 0,
    }));
    for (const event of relevant) {
      const hour = Number.isFinite(event.time) ? new Date(event.time).getUTCHours() : 0;
      hours[hour].pageviews++;
      if (event.visitor) hours[hour].visitors.add(event.visitor);
    }
    chart = hours.map((row) => ({
      key: row.key,
      label: row.label,
      visitors: row.visitors.size,
      pageviews: row.pageviews,
    }));
  }
  return {
    period,
    retentionDays: RETENTION_DAYS,
    dailyEventLimit: DAILY_EVENT_LIMIT,
    totals: {
      visitors,
      pageviews,
      dailyAverage: Math.round((visitors / period) * 10) / 10,
    },
    chart,
    referrals: ranked(relevant, 'referrer', 'Direct'),
    countries: ranked(relevant, 'country', 'ZZ'),
    pages: ranked(relevant, 'path', '/'),
  };
}
