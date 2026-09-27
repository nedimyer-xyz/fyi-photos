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
