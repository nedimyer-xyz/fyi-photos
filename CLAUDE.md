# fyi.photos project context

This repository contains Andrew Nedimyer's Tumblr photo theme and its private Vercel-hosted admin. Preserve the existing visual character and data model. Read `README.md` for detailed operation instructions.

## Live surfaces

- Photo site: `https://fyi.photos/`
- Admin: `https://admin.fyi.photos/`
- Admin Vercel project: `fyi-photos-admin`
- Local theme preview: `npm run preview:real` → `http://localhost:4321/`
- Local admin: `npm run admin:dev` → `http://localhost:4330/`

## Architecture

- `theme.html`: self-contained Tumblr HTML, CSS, JS and current People/Places/Series config.
- `admin/`: static admin UI.
- `api/`: Vercel functions for Tumblr OAuth, posting, tagging, theme export and analytics.
- `server/`: encrypted sessions, Blob-backed admin storage and analytics storage.
- `shared/`: tag/config/Tumblr helpers shared by admin and migration scripts.
- `migration/`: export, tag migration and local tagging tools.
- `preview/`: local Tumblr-theme renderer.
- `tests/`: Node regression tests. Run `npm test`.

## Current product behavior

### Public photo site

- Left navigation: Everything, People, Travel, Series, Info.
- Everything always starts in single-column feed view and stays chronological.
- Aggregate People is shuffled.
- Photo grids use masonry; Travel/Series category landing grids do not.
- Grid loading uses muted pastel masonry blocks that fill the viewport.
- Grid photos open a white fullscreen lightbox with keyboard/swipe navigation.
- Lightbox tags are subtle grey pills below the photo and align to the displayed image's left edge.
- Images lazy-load. Do not show visible Loading text or Tumblr ALT badges.
- Mobile photo taps advance the lightbox.

### Admin

- Dark navigation sidebar with a minimal white workspace.
- Pages: New post, Photo library, Analytics, People, Places and Series.
- New post initially shows only a `Create a post` upload button.
- Photo library edits per-photo tags and saves directly to Tumblr.
- People/Places/Series are separate organization views.
- `Copy theme` must always fetch a fresh generated theme.

### Analytics

- First-party endpoint: `https://admin.fyi.photos/api/analytics`.
- `GET` is authenticated dashboard data; `POST` is the public collector.
- Cookie-free; honors Do Not Track; no recordings or click tracking.
- Google Analytics was removed from `theme.html`.
- Never store raw IP addresses or user agents. They may only be used in memory to make the rotating daily visitor hash.
- Stored fields: timestamp, path without query/hash, referring domain, country code and daily hash.
- Storage is separate: Blob prefix `analytics/events/` or local `.admin-data/analytics/`.
- Retention is 30 days.
- Limits: 1,000 events per UTC day and 10 events per estimated visitor per minute.
- The Vercel Hobby project supports at most 12 functions. Keep collection and dashboard reads consolidated in `api/analytics.js`.

## Critical data-safety workflow

The admin's Blob store is the source of truth for current people, places, series, order and covers. Before changing or deploying `theme.html`, always run:

```bash
npm run pull-config
```

This injects current backend config into `theme.html` without replacing design code. Never overwrite `CONFIG` with an older local copy.

Before deploying, verify:

```bash
npm test
git diff --check
```

Deploy the admin with:

```bash
npx vercel deploy --prod
```

After a theme change, the admin shows `Theme update ready`. The user clicks `Copy theme`, then pastes the full result into Tumblr's Edit HTML screen. Tumblr posts, captions and post tags are separate from theme HTML and are not deleted by this operation.

## Authentication constraints

- Tumblr OAuth works with the registered callback:
  `https://fyi-photos-admin.vercel.app/api/auth/callback`
- It is configured through `OAUTH_CALLBACK_ORIGIN`.
- Vercel forwards the callback to `admin.fyi.photos`, where the session cookie is set.
- Do not casually switch OAuth back to the custom-domain callback; that previously caused login loops and expired-login errors.
- Never print or commit `.env.local`, Tumblr credentials, session secrets or Blob tokens.

## Validation expectations

- Use the smallest relevant test plus `npm test`.
- For UI validation, prefer headless Playwright screenshots/checks. Do not open an in-app browser canvas.
- Verify desktop and mobile layouts.
- Preserve type/data safety and surface errors rather than silently falling back.
- Do not change blog content, tags or covers unless explicitly requested.

## Current repository state

The admin redesign, masonry loading improvements, lightbox tag pills and analytics implementation are deployed but are not yet committed on this branch. Review `git status` before editing, preserve all existing changes and commit them before moving work to another checkout.
