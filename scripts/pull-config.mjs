// Pull the people / travel / series lists from the admin site into theme.html,
// so the repo's copy of the theme matches what the admin hands out.
//
//   npm run pull-config            (uses https://admin.fyi.photos)
//   ADMIN_URL=https://… npm run pull-config
import { readConfig, writeConfig } from '../migration/lib.mjs';

const CANDIDATES = process.env.ADMIN_URL ? [process.env.ADMIN_URL] : ['https://admin.fyi.photos', 'https://fyi-photos-admin.vercel.app'];
let res = null, ADMIN = '';
for (const base of CANDIDATES) {
  res = await fetch(`${base}/config.json`, { cache: 'no-store' }).catch(() => null);
  if (res && res.ok) { ADMIN = base; break; }
}
if (!res || !res.ok) {
  console.error(`✗ Couldn't reach the admin (${CANDIDATES.join(', ')})`);
  process.exit(1);
}
const remote = await res.json();
const local = await readConfig();
const count = (c) => ['people', 'travel', 'series'].map((k) => `${(c[k] || []).length} ${k}`).join(', ');
if (JSON.stringify(remote) === JSON.stringify(local)) {
  console.log(`✓ theme.html already matches the admin (${count(local)})`);
} else {
  await writeConfig(remote);
  console.log(`✓ Updated theme.html lists from the admin: ${count(remote)} (was ${count(local)})`);
}
