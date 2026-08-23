# Time to Spare

A calendar for planning a week deliberately — Google Calendar's job, done on
paper you chose yourself.

Sibling to [10 Minutes to Spare](https://github.com/iiiiii107/10-minutes-to-spare),
and built the same way: vanilla ES modules, no framework, no server.

## What it does

- **Four views** — week and day as a time grid, month as a wall calendar,
  agenda as a list. One paper stock and one accent across all four, so
  changing zoom never reads as arriving somewhere else.
- **Events as little paper cards**, laid out by the minute. Overlapping events
  share the width of a day; a chain of overlaps agrees on one width so nothing
  ends up stacked on top of anything else.
- **Click empty grid to make something.** Drag the body to move it, the edges
  to resize, across days as well as hours. Everything snaps to a step you set.
- **The pen pot**, carried over from the habit tracker. Drag a pen, highlighter
  or crayon across the week to say what matters; the eraser takes it back off.
  Marks are kept with the period you drew them on.
- **Yours to set** — which view opens, where the week starts, 12 or 24 hour,
  which hours are drawn and how tall an hour is, what the weekend gets, how
  long a new event is, the type, and the paper each view is printed on.

## Sync

Sign in with Google in *Other → Settings* and your calendar follows you between
devices. It is stored under your own account, and the security rules make that
the only place that account can reach.

Same Firebase project as [10 Minutes to Spare](https://github.com/iiiiii107/10-minutes-to-spare),
and the same sign-in — but its own document, `users/{uid}/app/calendar`. The
tracker uses `users/{uid}/app/state`; sharing a path would have had each app
overwrite the other every time you opened it.

The config goes in `.env.local` locally (copy `.env.example`) and in a
repository secret named `VITE_FIREBASE_CONFIG` for the deployed site. Leave it
out and the app runs without sync, saving to the browser.

## Not yet

**Google Calendar itself** — reading your real events in and pushing drafts up.
Signing in works; the Calendar API does not yet. The event model already
carries `origin` and `pushedAt`, so it is an addition rather than a migration
of everything you have written by then — and when it lands, an event will only
leave when you say so.

## Running it

```
npm install
npm run dev
```

`npm test` covers `src/lib/layout.js` — the lane algorithm that decides whether
a busy day reads or turns to mush. It is the one piece worth testing on its
own, and the one that goes wrong quietly.

## How it's put together

- `src/lib/layout.js` — pure geometry. Minutes, overlap, clusters, lanes.
- `src/lib/events.js` — what an event is, and moving or resizing one.
- `src/lib/store.js` — the only thing that mutates state.
- `src/lib/storage.js` — a facade over one backend at a time, so Google can be
  slid underneath without a view knowing.
- `src/views/grid.js` — minutes into pixels.
- `src/views/marker.js` — dragging a tool across a surface, written **once**.
  In the tracker this ended up copied into two views that then drifted.

Times are stored as local wall time (`2026-08-24T09:30`), never as UTC. What
you meant was "half nine on Tuesday", and that shouldn't move because you
crossed a border.

## Deploying

Every push to `main` runs the tests and, if they pass, builds and publishes to
GitHub Pages via `.github/workflows/deploy.yml`. Pages must be set to
**Source: GitHub Actions**.
