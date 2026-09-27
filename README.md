# fyi-photos — Tumblr photography portfolio theme

A single-file custom Tumblr theme built for showing photography. Fixed left sidebar,
square grid or stacked-list view, lazy loading, infinite scroll, lightbox, and a
Travel section with per-destination album pages.

## Install

1. Open your blog's theme editor: **tumblr.com → your blog → Edit appearance →
   Edit theme → Edit HTML**.
2. Delete the existing markup and paste the full contents of [`theme.html`](theme.html).
3. Click **Update preview**, then **Save**.

Everything (CSS and JS) is inlined in one file — no external assets to host.

## Customize-panel options

| Option | Default | Notes |
| --- | --- | --- |
| Tag 1 Label | Portraits | Label shown in the sidebar nav |
| Tag 1 Slug | portraits | URL slug: `/tagged/portraits` |
| Tag 2 Label | T-Dock | |
| Tag 2 Slug | t-dock | |
| Tag 3 Label | Challis | |
| Tag 3 Slug | challis | |
| Travel Trip Tags | mexico,japan,nicaragua,italy | Comma-separated list of trip tag slugs. These activate the Travel nav link and show a "← Travel" breadcrumb when browsing a trip. Add a new destination to this list whenever you create a new trip. |
| Accent | #000000 | |
| Use Lightbox | on | Click any photo to open fullscreen |

## How to post

1. **Drag-and-drop** photos directly into the Tumblr composer — exactly as you do now.
2. **Tag each photo** with one of your category or trip slugs (e.g., `portraits`, `t-dock`, `mexico`). That's what routes photos to the right filter page.
3. Click **Post**. Done.

## How Travel works

The Travel link in the sidebar points to `/travel`, which is a Tumblr **custom page** you create once.

### One-time setup — create the Travel index page

1. In the Tumblr web app go to **your blog → Edit appearance → Add a page**.
2. Set the URL to `travel` and enable **Custom Layout** (so the theme renders your HTML inside the sidebar).
3. Paste the following HTML into the body:

```html
<div class="travel-grid">
  <a href="/tagged/mexico" class="travel-card">
    <img src="PASTE_COVER_PHOTO_URL_HERE" alt="Mexico">
    <span class="travel-card-label">Mexico</span>
  </a>
  <a href="/tagged/japan" class="travel-card">
    <img src="PASTE_COVER_PHOTO_URL_HERE" alt="Japan">
    <span class="travel-card-label">Japan</span>
  </a>
  <a href="/tagged/nicaragua" class="travel-card">
    <img src="PASTE_COVER_PHOTO_URL_HERE" alt="Nicaragua">
    <span class="travel-card-label">Nicaragua</span>
  </a>
  <a href="/tagged/italy" class="travel-card">
    <img src="PASTE_COVER_PHOTO_URL_HERE" alt="Italy">
    <span class="travel-card-label">Italy</span>
  </a>
</div>
```

4. Replace each `PASTE_COVER_PHOTO_URL_HERE` with the URL of any photo you want as that destination's cover — right-click a photo on Tumblr and copy the image URL.
5. Save the page.

### Adding a new destination (e.g., Portugal)

1. In the Customize panel add `portugal` to the **Travel Trip Tags** field (comma-separated): `mexico,japan,nicaragua,italy,portugal`.
2. Edit the `/travel` custom page and add a new card for Portugal.
3. Tag your Portugal trip photos with `portugal` when you post them.

Clicking a destination card navigates to `/tagged/portugal` — the standard Tumblr tag page — so all your tagged photos appear there automatically. The sidebar shows "Travel" as active, and a "← Travel" breadcrumb appears at the top.

## Posting from a folder (sync script)

`sync/sync.js` posts photos from a folder on your computer to Tumblr, one photo
per post, with no caption. It needs Node 18 or newer and nothing else.

### Folder layout

```
photos/
  portraits/
    becky/        → tags: portraits, becky
  t-dock/         → tags: t-dock
  challis/        → tags: challis
  travel/
    mexico/       → tags: mexico  ("travel" only groups trips, it isn't a tag)
```

Each folder in a photo's path becomes a tag. For extra tags, add any of these;
they are all combined:

- **Keywords** in Lightroom, Apple Photos or Capture One (saved into the exported JPEG)
- **Finder tags** on a Mac (color-only tags are ignored)
- **`#tags` in the filename**, e.g. `market #becky.jpg`

Tags are lowercased and use hyphens (`Film & Grain` → `film-grain`).

### One-time setup

1. Register an app at <https://www.tumblr.com/oauth/apps>. Any name and website
   work. Under **OAuth2 redirect URLs** enter `http://localhost:3000/callback`.
2. Copy `sync/.env.example` to `sync/.env` and fill in the OAuth consumer key and
   secret, your blog name, and the path to your photos folder.
3. Run `node sync/auth.js`, then click **Allow** in the browser tab it opens.

### Everyday use

```bash
node sync/sync.js                         # preview: lists new photos and their tags
node sync/sync.js --post --draft --limit 3  # test: saves 3 photos as Tumblr drafts
node sync/sync.js --post                  # publish every new photo
node sync/sync.js --retag                 # push tag changes to photos already posted
```

- The script posts oldest photos first, using each photo's capture date, so the
  newest photos end up at the top.
- It keeps a log in the photos folder (`.tumblr-posted.json`), so re-running only
  posts new photos. Draft test runs use a separate log, so drafts are posted
  again for real later. Delete test drafts on Tumblr yourself.
- If Tumblr's daily posting limit is reached, it stops. Run the same command the
  next day to continue.
- A re-edited or re-exported photo counts as a new photo and gets posted again.
- Updating tags keeps any tags you added by hand on Tumblr.
- The preview prints the value for the theme's **Travel Trip Tags** setting,
  built from your `travel/` folders.

## Previewing locally

Tumblr template tags only resolve on Tumblr itself. A small Node script fills them
with sample data for browser testing:

```bash
node scripts/render.js theme.html preview/index.html index       # everything
node scripts/render.js theme.html preview/tag.html    tag        # portraits
node scripts/render.js theme.html preview/travel.html page       # travel index

# With overrides:
TAG=t-dock node scripts/render.js theme.html preview/tag.html tag
```

Open the generated files in a browser to check layout, lightbox, and responsiveness.
