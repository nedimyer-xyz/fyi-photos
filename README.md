# fyi-photos — Tumblr photography portfolio theme

A single-file custom Tumblr theme built for showing photography. Masonry / grid /
single-column layouts, a keyboard- and touch-friendly lightbox, infinite scroll,
hover captions, EXIF/camera info on permalinks, and a set of Customize-panel
options so it can be restyled without touching code.

## Install

1. Open your blog's theme editor: **tumblr.com → your blog → Edit appearance →
   Edit theme → Edit HTML**.
2. Delete the existing markup and paste the full contents of [`theme.html`](theme.html).
3. Click **Update preview**, then **Save**.

That's it — everything (CSS and JS) is inlined in the one file, so there are no
external assets to host.

## Customize-panel options

| Option | Choices / type | Default | Notes |
| --- | --- | --- | --- |
| Layout | Masonry / Square grid / Single column | Masonry | Masonry keeps chronological order across balanced columns. |
| Columns | 2 / 3 / 4 | 3 | Caps the column count; the theme steps down on smaller screens. |
| Gutter | Tight (4px) / Medium (16px) / Wide (32px) | Medium | Space between tiles. |
| Typeface | Serif headings / Sans everything | Serif | Serif uses Cormorant Garamond; body is always Inter. |
| Pagination | Infinite scroll / Load more button / Previous-next links | Infinite | Classic links are the no-JS fallback. |
| Use Lightbox | toggle | on | Click a photo to open a fullscreen viewer. |
| Show Captions On Hover | toggle | on | Caption overlay on hover (hidden on touch). |
| Show Camera Info | toggle | on | Shows EXIF (camera, focal length, aperture, shutter) on permalinks when Tumblr has it. |
| Hide Non Photo Posts | toggle | off | Keeps the grid photo-only (text/quote/link/video hidden on the index). |
| Show Description | toggle | on | Blog description under the title. |
| Protect Images | toggle | off | Deters right-click/drag saving (a deterrent, not real protection). |
| Background / Text / Muted Text / Accent / Lightbox Background | colors | neutral gallery palette | |
| Logo | image | — | Replaces the text title when set. |
| Instagram Username / Email Address / Website URL / Footer Text | text | — | Populate nav and footer links. |

## What it supports

- **Post types:** photo, photoset (with a count badge), text, quote, link, video,
  audio, chat, and answer. On the index, non-photo posts render as clean cards.
- **Photoset lightbox:** every image in a set is individually browsable.
- **Pages:** index, permalink, tag pages, and search (with the footer search box).
- **Accessibility:** focus states, a focus-trapped lightbox, `aria` labels,
  reduced-motion support, and lazy-loaded images.

## Developing / previewing locally

Tumblr tags (`{block:Posts}`, `{PhotoURL-HighRes}`, …) only resolve on Tumblr, so
there's a small preview harness that fills them with sample data.

```bash
node scripts/render.js theme.html preview/index.html index       # index page
node scripts/render.js theme.html preview/permalink.html permalink
# override options: LAYOUT=grid COLUMNS=4 TYPEFACE=sans node scripts/render.js ...
```

Open the generated files in a browser to check layout, the lightbox, and
responsiveness. The harness is a preview aid only — it is not part of the theme.
