// Set a Travel/Series landing-page cover from a photo already on the blog.
//
//   npm run set-cover -- <tag> <image file name, Tumblr URL, or media hash>
//
// e.g. npm run set-cover -- thailand tumblr_aa396ed7aa2021396baf342dd3b27c86_8d229c51_1280.jpg
import { POSTS_FILE, readJSON, readConfig, writeConfig, slug } from './lib.mjs';

const [tagArg, imageArg] = process.argv.slice(2);
if (!tagArg || !imageArg) {
  console.error('Usage: npm run set-cover -- <tag> <image file name | URL | media hash>');
  process.exit(1);
}
const tag = slug(tagArg);
const hash = (imageArg.match(/[0-9a-f]{32}/) || [])[0];
if (!hash) throw new Error('Could not find a Tumblr media id (32 hex characters) in: ' + imageArg);

const exported = await readJSON(POSTS_FILE, null);
const photo = exported && exported.posts.flatMap((p) => p.photos).find((ph) => ph.key.startsWith(hash + '/'));
if (!photo) throw new Error('That photo is not in the export. Is it posted on the blog? (npm run export to refresh)');

const cfg = await readConfig();
const entry = [...cfg.travel, ...cfg.series].find((e) => e.tag === tag);
if (!entry) throw new Error(`"${tag}" is not a Travel or Series tag. Known: ${[...cfg.travel, ...cfg.series].map((e) => e.tag).join(', ')}`);
entry.cover = photo.full;
await writeConfig(cfg);
console.log(`✓ ${entry.label} cover → ${photo.full}`);
