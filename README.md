# fyi.photos Tumblr theme

A self-contained Tumblr theme for [fyi.photos](https://fyi.photos). `theme.html` contains all of the HTML, CSS and JS.

## Admin site: admin.fyi.photos

The easiest way to post and tag. Log in with the Tumblr account that owns fyi.photos; nobody else can get in.

- **New post:** drop in photos (they're resized to 2048 px before uploading). Drag to reorder, click photos and then tag chips to tag them, and add an optional caption. Then **Publish**, **Add to queue** or **Save as draft**, optionally with a past date. Post tags and per-photo `[tags]` are set for you. Tumblr allows about 150 photo uploads a day.
- **Photo library:** filter the contact sheet by status, tag, or year. Select photos and edit their tags in the details panel; every change saves straight to Tumblr (the dot next to each post turns green). Use **R** to mark a post reviewed and **U** to jump to the next unreviewed one.
- **Analytics:** estimated daily visitors, pageviews, traffic trends, referral domains, countries and top pages for Today, 7 days or 30 days.
- **Organize → People / Places / Series:** separate pages for managing names and categories. **Set cover** picks from that place's or series' photos, and you can drag the Places/Series tiles to set their order on the site. Existing `#tag` and `#lists` links still work.
- **Theme banner:** when the lists change, a "Changes made" banner appears. Click **Copy theme**, then in Tumblr open **Edit HTML → ⌘A → ⌘V → Update preview → Save**. Run `npm run pull-config` to update the repo's `theme.html` to match.

Tag buttons are always A–Z.

The admin has a dark navigation sidebar and a white workspace. New post starts with an upload area; post details appear after photos are added. Tag categories collapse and include a search field to avoid displaying every name at once. These interface changes do not change the public theme, stored tag slugs, or publishing endpoints.

### Analytics privacy and limits

The theme sends one small first-party pageview event to `admin.fyi.photos/api/analytics`; Google Analytics is not loaded. Tracking is cookie-free, honors browser Do Not Track, excludes obvious bots and records no sessions, clicks, recordings or query strings.

- The request IP and user agent are used only in memory to create a daily rotating visitor hash. Neither raw value is stored.
- Stored fields are timestamp, page path, referring domain, country code and the daily hash.
- Analytics lives under the separate `analytics/events/` Blob prefix (or `.admin-data/analytics/` locally), never in the blog/tag store.
- Data older than 30 days is deleted. Collection is capped at 1,000 pageviews per UTC day and 10 events per estimated visitor per minute.
- `SESSION_SECRET` signs the daily hash, so no additional service account or environment variable is required. `ANALYTICS_SECRET` may optionally provide a separate 32+ character secret.

### How it's built

| Path | What |
|---|---|
| `admin/` | The web app (static HTML/CSS/JS) |
| `api/` | Vercel functions: Tumblr login, posts, tag saving, uploads, publishing, lists, theme |
| `server/` | Session cookies (AES-GCM, `SESSION_SECRET`) and storage (Vercel Blob) |
| `shared/` | Tag/alt/theme helpers and Tumblr API calls, shared with the local scripts |

- Vercel project `fyi-photos-admin`, with environment variables `TUMBLR_CLIENT_ID`, `TUMBLR_CLIENT_SECRET`, `SESSION_SECRET`, `TUMBLR_BLOG` and `BLOB_READ_WRITE_TOKEN`.
- **Tumblr login:** uses the "fyi.photos admin" Tumblr app, whose redirect URL is `https://fyi-photos-admin.vercel.app/api/auth/callback`, set via `OAUTH_CALLBACK_ORIGIN`. Vercel forwards every request on that host to admin.fyi.photos, so the login cookie lands there. To change the keys, run `bash scripts/set-admin-keys.sh`.
- DNS: `A admin → 76.76.21.21`.
- **Deploy:** `npx vercel deploy --prod`.
- **Local development:** `npm run admin:dev` (http://localhost:4330). It reads `.env.local`, which `npx vercel env pull` creates. Without `BLOB_READ_WRITE_TOKEN`, data is kept in `.admin-data/`.
- **Testing without touching Tumblr:** run `node scripts/mock-tumblr.mjs`, then start the dev server with `TUMBLR_API=http://localhost:4399/v2 TUMBLR_WWW=http://localhost:4399`.

## Publishing

Do these in order. The tags go first so the People, Travel and Series pages aren't empty when the new theme goes live.

1. **Log in once:** `npm run auth` (see *Retagging existing posts* below).
2. **Test one post:** `npm run migrate:apply -- --only <postId>`, then check it on the blog.
3. **Push all tags:** `npm run migrate:apply` (about 10 minutes; safe to stop and re-run).
4. **Install the theme:** in Tumblr, open **Edit appearance → Edit theme → Edit HTML**. Select all, paste the contents of `theme.html` (`pbcopy < theme.html` copies it), then **Update preview → Save**.
5. **Info page:** **Edit appearance → Pages → Add a page**, set the URL to `info`, leave it empty, and save.

Whenever `theme.html` changes (new people, places, covers, design tweaks), paste it into Tumblr again.

Design changes must also be deployed to the admin (`npx vercel deploy --prod`) before using **Copy theme** again: it combines the deployed template with the saved lists. Run `npm run pull-config` before deploying to preserve the current lists in the repository. Copy theme fetches a fresh export on every click; the production build checks that list injection preserves the template, lightbox tags, and masonry loading. Avoid pasting older saved copies, which still replace the entire Tumblr theme.

## Posting new photos (without the admin)

**One subject per post (simplest).** Post the photos as usual and add tags in Tumblr's tag field:

| Photo of | Tags to add |
|---|---|
| A person | `people`, `bucky-armbruster` |
| A place | `travel`, `japan` |
| A series | `series`, `t-dock` |
| Person on a trip | `people`, `bucky-armbruster`, `travel`, `japan` |

- Type tags exactly as they appear in the URL: lowercase, with hyphens instead of spaces (`/tagged/bucky-armbruster` → `bucky-armbruster`). The full list is in `CONFIG` in `theme.html`, and in the People / Travel dropdowns on the site.
- Every post shows on Everything automatically; no tag needed.
- If no photo in a post has `[tags]` in its alt text, every photo in it appears on each of the post's tag pages.

**Mixed posts (different people or places in one post).** Either:
- **In Tumblr:** add the post tags above, then give each image alt text ending in its own tags, e.g. `[bucky-armbruster, japan]`. Only the matching photos then show on each page.
- **With the tagger (easier for big posts):** post without tags, then run:
  ```sh
  npm run export          # pull in the new posts
  npm run tagger          # tag the new photos, http://localhost:4323
  npm run migrate:apply   # writes post tags + per-photo alt tags to Tumblr
  ```

**New person, place or series.**
1. Add it to `CONFIG` in `theme.html` (or use **+ Add** in the tagger, which edits `CONFIG` for you).
2. For a place or series, set a cover: `npm run set-cover -- <tag> <image file name or URL>`.
3. Paste the updated `theme.html` into Tumblr.

Until step 3, the new tag's page still works, but it won't appear in the dropdowns, on landing pages, or as a person/place heading.

## Navigation and tags

| Nav item   | URL               | Shows                                                |
|------------|-------------------|------------------------------------------------------|
| Everything | `/`               | Every post, as one long stream                       |
| People     | `/tagged/people`  | Every portrait, shuffled on each visit. "People / Everyone ▾" (or the person button, bottom right) opens the list of names |
| Travel     | `/tagged/travel`  | Landing grid of locations → `/tagged/italy`, etc. "Travel / Everywhere ▾" lists every place |
| Series     | `/tagged/series`  | Landing grid of series → `/tagged/t-dock`, etc.      |

Tag each post with a **category tag** plus **specific tags**. A post can have as many as you like:

- `people` + `bucky-armbruster` → appears under People / Everyone and People / Bucky Armbruster
- `people` + `bucky-armbruster` + `travel` + `japan` → also appears on the Japan page
- `travel` + `italy`
- `series` + `t-dock`

Posts can mix subjects. Each photo also carries its own tags at the end of its alt text, e.g. `[bucky-armbruster, japan]`. On a People, Travel or Series page, the theme shows only the matching photos from each post and hides the bracket text. Posts without per-photo tags show all their photos. The retagging tools below handle all of this for you.

## Editing people, places and series

Edit the `CONFIG` block at the top of the `<script>` near the end of `theme.html`:

```js
people: [ { tag: 'bucky-armbruster', label: 'Bucky Armbruster' }, … ],
travel: [ { tag: 'japan', label: 'Japan', cover: 'https://64.media.tumblr.com/…/s1280x1920/….jpg' }, … ],
series: [ { tag: 't-dock', label: 'T-Dock', cover: '' }, … ]
```

- `tag` must match the Tumblr tag in the URL (`/tagged/t-dock` → `'t-dock'`).
- `cover` is the image shown on the Travel/Series landing tile, at the photo's own shape. Leave it as `''` to show a pastel 3:2 tile.
  - To get a URL, open a photo on your blog, right-click → **Copy image address**. A `s1280x1920` size works well.
- Order in the list is the order on the page.

## Info page

`/info` is rendered by the theme from the `INFO` block at the top of the script in `theme.html`: the text, email (with a copy button), Instagram handle and an optional `photo` URL.

In Tumblr, create a page at **Edit appearance → Pages → Add a page** with the URL `info` and **leave it empty**, so the address exists. The theme fills in the content.

## Features

- **Feed / grid toggle:** a fixed button at the bottom right of every photo stream. Everything always opens as a single column. The other pages remember the visitor's last choice.
- **Grid layout:** masonry, with uncropped photos stacked in columns. To go back to rows, set `GRID_LAYOUT = 'grid'` in `theme.html`.
- **Grid loading:** pastel blocks use the same masonry columns and photo proportions, fill at least the browser height, and adapt on resize. Individual photos retain their pastel placeholders until they fade in.
- **Grid columns** are set per page type in `GRID_COLUMNS` in `theme.html`: Everything 4, a single place or series 3, People 4. Phones (and windows under 900px) use 2.
- **Lightbox:** in grid view, clicking a photo opens it fullscreen on white.
  - Navigate with ← / → (or swipe on mobile); close with Esc.
  - More photos load automatically when you reach the end.
- **Lazy loading:** photos show a muted pastel placeholder at their exact size and load only as they approach the viewport. Older pages load automatically as you scroll, for the current tag only.
- **Custom CSS:** the theme ignores Tumblr's *Advanced options → Add custom CSS* box. Leftover CSS from the old theme there broke the layout, so make design changes in `theme.html` instead.

## Retagging existing posts (bulk, in place)

This edits your existing posts and never re-uploads anything, so dates, notes and permalinks stay the same. You need Node 20 or newer.

```sh
npm run export          # 1. snapshot all posts + photos (and a backup for rollback)
npm run tagger          # 2. tag photos in a local web app → http://localhost:4323
npm run migrate:plan    # 3. dry run: see exactly what will change
npm run auth            # 4. one-time Tumblr login (see below)
npm run migrate:apply -- --only <postId>   # 5. try one post, then check it on the blog
npm run migrate:apply   # 6. apply everything
```

**1. Export.**
- Without logging in, this reads the public feed, which is enough to start tagging.
- After `npm run auth` it uses the official API instead.
- Everything is saved to `migration/data/`, which is gitignored. The first `backup-*.json` is your "before" snapshot.

**2. Tagger.** A contact sheet of every post.
- **Selecting:** click a photo; ⇧-click selects a range; ⌘-click adds or removes one; drag a box to select several. `A` selects the current post.
- **Tagging:** click a chip such as *Bucky* or *Japan* to tag the selection. Click it again to remove the tag. Keys `1`–`9` toggle the chips you've used.
- **"Someone else" / "Other travel":** tags a photo for the category page only, without a specific name.
- **+ Add:** creates a new person, location or series and writes it into `CONFIG` in `theme.html`.
- **Moving through posts:** `R` marks the post reviewed and jumps to the next one. `J`/`K` move between posts, `U` jumps to the next unreviewed post, and ⌘Z undoes.
- **Saving:** changes save automatically to `migration/data/tags.json`. You can stop and come back any time.
- **Pre-filled tags:** posts already tagged `t-dock` or `challis` start with those tags filled in.

**Check your work.** Run `npm run preview:real` and open <http://localhost:4321>. It renders the theme with your real photos and the tags saved so far. Refresh to pick up new tags. The tagger also links to it.

**3. Plan.** Writes `migration/data/plan.txt` with every tag and alt-text change. Nothing is sent to Tumblr.

**4. Auth.**
1. Register an app at <https://www.tumblr.com/oauth/apps>.
2. Set both the default callback URL and the OAuth2 redirect URL to `http://localhost:4322/callback`.
3. Run `npm run auth` and paste the consumer key and secret when asked.

Credentials are stored in `migration/.secrets.json`, which is gitignored.

**5–6. Apply.**
- Each post is re-read from Tumblr right before editing, and only its tags and image alt text are changed. Everything else, including the publish date, stays the same. After saving, the script reads the post back to verify.
- It makes about one request per second, so a full run takes roughly 10 minutes.
- It's safe to stop and re-run; posts that are already done are skipped.
- `--only` also checks that the rendered page exposes the `[tags]` to the theme. Don't run the full apply if that check warns.
- If you keep tagging later, just run `migrate:apply` again.

**Undo.** `npm run migrate:rollback` restores the original tags and alt text, from the first backup, for every post the script changed. Use `--only <postId>` to restore just one post.

## Local preview

You need Node 18 or newer.

```sh
npm run fetch-sample   # downloads a few real posts from fyi.photos into preview/.cache
npm run preview        # http://localhost:4321
```

- The preview server renders `theme.html` with the sample posts and fake tags. Try `/`, `/tagged/people`, `/tagged/bucky`, `/tagged/travel`, `/tagged/italy`, `/tagged/series` and `/post/<id>`.
- Sample posts get fake per-photo `[tags]`; every 4th post is left untagged to show the fallback. It re-reads the theme on every request, so just refresh after edits.
- It also warns about `{Word}` patterns that Tumblr's template parser might swallow.
- Environment options: `PER_PAGE=4`, `PREVIEW_DELAY=800` (simulates slow page loads), `PORT=4321`.

## Notes

- **Fonts:** the Stabil Grotesk files at `nedimyer.xyz/fonts/` currently return 404, so the live site falls back to the system sans-serif. Re-upload them to restore the font; the server must send `Access-Control-Allow-Origin` for fyi.photos. The theme's `@font-face` rules will pick them up.
- **JavaScript is required to see photos.** Post bodies sit inside `<template>` tags so hundreds of images don't download at once.
