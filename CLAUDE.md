# Wandering Wojo — Project Context

## What This Is

A travel journal website for Van and his cat Wojo, documenting their van trip from Oregon through the Southwest toward Alaska. Pure static site hosted on GitHub Pages. The map is the entire interface — no separate pages, no frameworks, no build tools.

## Architecture

```
index.html              Single-page shell (map + floating UI + lightbox)
css/main.css            Complete design system with CSS variables + dark mode
js/main.js              App controller: data loading, entry nav, lightbox, keyboard
js/map.js               Mapbox GL JS: map init, route line, cork pins, expanded entries
data/entries.json        Journal entries array (the content)
data/locations.json      Map waypoints (visited/current/planned dots)
tools/journal.py         Local Python tool for adding/editing/deleting entries
media/photos/            Trip photos
media/wojo/              Wojo-specific photos
.claude/launch.json      Dev server config (npx serve on port 8080)
```

## Key Design Decisions

### Map-Only Mode
The site is purely map-based. No separate journal feed, no view toggle, no header. The map fills the entire viewport. Floating UI overlays sit on top:
- **"Wandering Wojo" title** — fixed top-right corner, clickable to expand/collapse a description paragraph
- **Entry navigation** — fixed bottom-center, `< 1/4 >` style with prev/next buttons
- **Cork board pins** — Mapbox custom HTML markers showing entry cards on the map

### Entry Navigation
Entries are sorted chronologically (oldest first). The nav counter at the bottom lets you step through them. Clicking prev/next:
1. Closes any expanded pin
2. Flies the map to the entry's location
3. Highlights the pin (border + pulse animation)
4. Does NOT auto-expand — user clicks the pin to read

Arrow keys also navigate entries (or lightbox photos when lightbox is open). ESC closes expanded entry or lightbox.

### Route Line
The dashed route line is built dynamically from entry coordinates only — it connects entries in chronological order. No hardcoded future waypoints. When new entries are added, the route extends automatically.

### Location Markers
Small dots on the map from `data/locations.json`. Only locations that have a matching journal entry (by `location_name`) are shown. Locations without entries are hidden.

### Cork Pin Cards
Each pin shows: type badge, title, date, and entry number (e.g. "3/4") in the bottom-right corner. Clicking expands the entry in-place with full content, mood bar, photos, video embed, and Giscus comments placeholder.

### Expanded Entry Close Button
The X close button uses `position: sticky; top: 0; float: right;` so it stays at the top of the scrollable entry card while content scrolls beneath it. The entry container has `max-height: 80vh; overflow-y: auto`.

### Dark Mode
Automatic via `prefers-color-scheme`. All colors are CSS custom properties in `:root`, overridden in a `@media (prefers-color-scheme: dark)` block. The Mapbox map switches between `dark-v11` and `light-v11` styles based on system theme (set once at page load).

### Coordinate Convention
- **entries.json** stores coordinates as `[lat, lng]` (geographic convention)
- **Mapbox** requires `[lng, lat]` (GeoJSON convention)
- Conversion happens in `map.js`: `[entry.coordinates[1], entry.coordinates[0]]`
- **locations.json** already uses `[lng, lat]` (Mapbox-native)

## Entry Schema (data/entries.json)

```json
{
  "id": "2025-03-28-red-country",
  "date": "2025-03-28",
  "title": "Red country",
  "type": "field-notes",
  "location_name": "Moab, Utah",
  "coordinates": [38.5733, -109.5498],
  "body": "Full entry text here...",
  "video_url": null,
  "photos": [],
  "mood_left": "calm",
  "mood_right": "awed",
  "mood_value": 0.35
}
```

Entry types: `field-notes` (Wojo voice), `dispatch` (Van voice), `video-log`, `wojo-report`

Mood bar: `mood_left` and `mood_right` are labels for each end of the spectrum. `mood_value` is 0-1 (0 = fully left, 1 = fully right). Color interpolates from sage (#7C9A7E) to terracotta (#C1440E).

## Location Schema (data/locations.json)

```json
{
  "id": "loc-005",
  "name": "Moab, Utah",
  "coordinates": [-109.5498, 38.5733],
  "date_arrived": "2025-03-27",
  "status": "current",
  "note": "Red rock country. BLM camping by the river."
}
```

Status values: `visited`, `current`, `planned`. Only locations matching an entry's `location_name` are rendered on the map.

## Journal Tool (tools/journal.py)

A self-contained Python 3 script (stdlib only, zero pip dependencies) that runs a local web server with a browser-based UI for managing entries. Run with:

```bash
python3 tools/journal.py          # opens http://127.0.0.1:5555
python3 tools/journal.py --port 8888
```

Features:
- **Add new entries** with live preview, mood bar slider, all fields
- **Edit existing entries** by clicking them in the entry list
- **Delete entries** with confirmation
- Saves to `data/entries.json`, auto git add + commit + push
- Dark mode matches system theme
- Same visual design tokens as the main site

API endpoints:
- `GET /` — serves the HTML page
- `GET /api/entries` — returns all entries as JSON
- `POST /api/save-entry` — append a new entry
- `POST /api/update-entry` — update an existing entry by ID
- `POST /api/delete-entry` — delete an entry by ID

## Anonymous Contact Form

An anonymous message form lives inside the expandable "Wandering Wojo" title panel. Powered by [Formsubmit.co](https://formsubmit.co) — no backend needed. Messages are forwarded to the email set in `CONTACT_EMAIL` in `js/main.js`.

- If `CONTACT_EMAIL` is empty, the form is hidden automatically
- First time a message is submitted, Formsubmit sends a confirmation email — click the link to activate
- After activation, all messages arrive in your inbox
- No sender info is collected — completely anonymous unless the sender includes their own contact info
- Uses the `/ajax/` endpoint with `fetch()` for inline success/error feedback (no page redirect)

To change the recipient email, edit the `CONTACT_EMAIL` variable at the top of `js/main.js`.

## Giscus Comments (Optional, Not Configured)

Comments use Giscus (GitHub Discussions). Currently disabled because `GISCUS_REPO_ID` and `GISCUS_CATEGORY_ID` are empty strings in `js/main.js`. To enable:
1. Enable Discussions on your GitHub repo
2. Create a "Journal Comments" category
3. Configure at giscus.app and fill in the IDs

## Dev Server

```bash
npx serve -l 8080    # from project root
```

Or use Claude's preview system which reads `.claude/launch.json`.

## Mapbox Token

Public token (`pk.*`) stored in `js/map.js` line 12. Free tier. This is **not** a secret — Mapbox public tokens are designed for frontend use and are safe in public repos. The token has URL restrictions configured in the Mapbox account dashboard so it only works from `thealetree.github.io` and `localhost`. The site gracefully degrades without a token (shows a fallback message).

## Security Model

- **Mapbox token**: Public token with URL restrictions — safe in public repo. Cannot be used from other domains.
- **Journal entries**: Only modifiable via local git push. The journal tool (`tools/journal.py`) runs on `127.0.0.1` (localhost only, not internet-accessible). GitHub Pages is read-only static hosting — no API for writing.
- **Git access**: Only accounts with push permission to `thealetree/wanderingwojo` can modify content. The repo is public for reading, private for writing.

## CSS Design System

Font stack: DM Sans (display), Inter (body), JetBrains Mono (mono/labels)

Color palette is entirely warm neutrals — no blue, no bright accents. The "accent" color is just `--charcoal` / `--near-black`. Dark mode inverts the entire palette by overriding CSS custom properties.

Key CSS variable families: `--white` through `--near-black` (8 shades), `--shadow-sm/md/lg/xl`, `--transition-fast/med/slow`, `--space-xs` through `--space-3xl`.

## Common Tasks

### Adding a new entry
Run `python3 tools/journal.py`, fill out the form, click "Save & Push". The tool auto-generates the entry ID from date + title slug.

### Adding a new location waypoint
Edit `data/locations.json` directly. The location will only appear on the map if an entry's `location_name` matches the location's `name`.

### Adding photos to an entry
1. Put images in `media/photos/` or `media/wojo/`
2. In the journal tool, add comma-separated paths in the Photos field (e.g. `media/photos/moab-sunset.jpg, media/photos/wojo-van.jpg`)

### Changing the map center/zoom
Edit `js/map.js` line 42-43: `center: [-112, 40]` and `zoom: 5`. These are the initial viewport when the page loads.
