# Track & Trace frontend

This is the frontend-only prototype entry point. Open `frontend/index.html` in the browser.

## Current split

- `index.html` — application shell and navigation markup.
- `css/app.css` — extracted prototype styles.
- `js/app.js` — extracted prototype runtime (local mock data, rendering, interactions).
- `track-and-trace-prototype.legacy.html` — untouched fallback copy of the previous single-file prototype.

The runtime is intentionally still one module during this first migration so the UI behavior remains unchanged without a bundler or backend. The next safe split is to move `app.js` into `data/`, `state/`, `components/`, and `pages/` modules one page at a time.
