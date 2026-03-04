# Wandering Wojo

A travel journal. Southwest to Alaska.

---

## Setup

### 1. Mapbox Token (Free)

The interactive map requires a free Mapbox access token.

1. Create a free account at [mapbox.com](https://account.mapbox.com/)
2. Copy your **Default public token** from the dashboard
3. Open `js/map.js` and replace the token value:

```js
const MAPBOX_TOKEN = 'pk.your_token_here';
```

The site works without a token — it shows a styled fallback.

### 2. Giscus Comments (Optional)

Comments use [Giscus](https://giscus.app/), powered by GitHub Discussions.

1. Enable **Discussions** on your GitHub repository
2. Create a Discussion category called **"Journal Comments"**
3. Go to [giscus.app](https://giscus.app/) and configure it for your repo
4. Copy the `data-repo-id` and `data-category-id` values
5. Open `js/main.js` and fill in the `GISCUS_REPO_ID` and `GISCUS_CATEGORY_ID` variables

### 3. Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/your-username/your-repo.git
git push -u origin main
```

Go to repo **Settings → Pages** and set the source to `main` branch, root folder.

---

## Adding Entries

Use the local journal tool to add new entries. It saves to `data/entries.json` and pushes to git automatically.

```bash
python3 tools/journal.py
```

This opens a browser-based form on `http://127.0.0.1:5555` with:
- Live preview of your entry
- Mood bar with customizable labels
- Auto-save to entries.json + git commit + push

Use `--port 8888` to change the port if needed.

### Entry Types

| Type | Voice | Description |
|------|-------|-------------|
| `field-notes` | Wojo | Default. Wojo's observations — dry, perceptive |
| `dispatch` | Van | Technical, logistical, first-person from Van |
| `video-log` | Either | Includes a video embed URL |
| `wojo-report` | Wojo | Wojo-specific dispatches |

### Photos

1. Add images to `media/photos/` or `media/wojo/`
2. Reference them in the entry's `photos` field as comma-separated paths

### Locations

Edit `data/locations.json` directly to add/update map waypoints (coordinates, status, notes).

---

## Dark Mode

Both the website and journal tool automatically switch between light and dark mode based on your system theme. No manual toggle needed.

---

## File Structure

```
index.html              Main site
css/main.css            Design system and all styles
js/main.js              Core app: data loading, views, lightbox, animations
js/map.js               Mapbox: map, markers, cork board pins, route
tools/journal.py        Local journal entry tool (Python)
data/entries.json       Journal entries
data/locations.json     Map waypoints
media/wojo/             Wojo photos
media/photos/           Trip photos
```

---

## Views

- **Map** (default) — Full-viewport map with journal entries pinned to their locations. Click a pin to expand the entry in place.
- **Journal** — Scrolling feed of entries in reverse chronological order, with the map above.

Toggle between views using the button in the top-right corner.

---

## Tech

- Pure static site: HTML, CSS, vanilla JavaScript
- No build tools, no frameworks, no npm
- Mapbox GL JS (CDN) for the interactive map
- Giscus for GitHub Discussions-based comments (optional)
- Google Fonts: Inter, DM Sans, JetBrains Mono
- Python 3 (stdlib only) for the local journal tool
