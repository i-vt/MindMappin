# Blumind Web

A lightweight, self-hosted **web mind-mapping tool** — an open alternative to the discontinued
[Blumind](https://alternativeto.net/software/blumind/about) desktop app, rebuilt with Node.js and a
zero-dependency vanilla-JS front end. It keeps Blumind's "do one thing well" spirit while adding the
things the original never had: it runs in any browser, stores maps server-side, and has a real
undo/redo history.

![layouts: mind map · tree · org chart · logic](https://img.shields.io/badge/layouts-mindmap%20%C2%B7%20tree%20%C2%B7%20org%20%C2%B7%20logic-14303A)

## Features

Everything Blumind did, on the web:

- **Four layouts, switched with one click** — mind map, tree diagram, org chart, and logic
  (left-to-right) diagram. The same topics re-flow instantly between them.
- **Rich topics** — per-topic icons, a progress bar, a note (shown as a tooltip), a clickable link,
  and a custom fill color.
- **Cross-links** — draw labelled connections between any two topics, not just parent/child.
- **Collapse / expand** any branch; **Expand all** / **Collapse all** in one click.
- **Keyboard-driven editing** — `Tab` adds a child, `Enter` adds a sibling, `F2`/double-click
  renames, `Delete` removes, arrow keys navigate, `Space` folds.
- **Tabs** — work on several maps at once.
- **Find & replace** across all topics, with case sensitivity and match stepping.
- **Dark mode by default**, with a one-click switch to light mode (top bar). The whole UI —
  chrome, panels, dialogs, and canvas — follows, and the choice is remembered.
- **Color themes** — six built-in canvas palettes (Blueprint, Paper, Slate, Meadow, Grape, Mono);
  each topic can still override its own color. The default palette tracks the dark/light mode.
- **Full-screen** view and **print**.
- **Export** to PNG, JPEG, GIF, BMP, TIFF, SVG, PDF, plain-text outline, CSV, and **FreeMind
  (`.mm`)**. Import `.mm` and native `.json`.
- **Pan & zoom** (drag to pan, scroll to zoom, `0` to fit).

Improvements over the original:

- A proper **undo/redo stack** (the desktop app's weak spot).
- **Server-side storage** so maps persist across machines, plus a browser session that restores your
  open tabs on reload.
- Cross-platform (any modern browser) instead of Windows-only.

## Run it

### With Docker (recommended)

```bash
docker compose up --build
```

Then open <http://localhost:3000>. Maps are stored in the `blumind-data` Docker volume.

Or build and run the image directly:

```bash
docker build -t blumind-web .
docker run -p 3000:3000 -v blumind-data:/data blumind-web
```

### With Node directly

Requires Node.js 18+.

```bash
npm install
npm start
```

Open <http://localhost:3000>. Maps are stored as JSON files in `./data` (override with the
`DATA_DIR` environment variable; the port is set with `PORT`).

> Server-side image export uses [`sharp`](https://sharp.pixelplumbing.com/). The Docker image
> installs the `fonts-liberation` and `fonts-noto-color-emoji` packages so exported text and icons
> render correctly; if you run outside Docker, make sure similar fonts are available for the best
> raster output.

## How it works

- **Front end** — plain ES modules, no build step and no runtime CDN. The map is drawn as live SVG;
  layouts are computed in `public/js/layout.js`, rendering and interaction live in
  `public/js/mapview.js`, and `public/js/app.js` wires up the chrome (tabs, toolbar, inspector,
  search, storage).
- **Back end** — a small Express server that hosts the static app, stores maps as JSON, and renders
  raster/PDF exports from the SVG the browser sends it.

### Data model

A map is JSON:

```json
{
  "id": "…",
  "title": "My map",
  "layout": "mindmap",
  "theme": "blueprint",
  "root": {
    "id": "…",
    "text": "Central idea",
    "icon": "star",
    "progress": 50,
    "note": "…",
    "link": "https://…",
    "color": "#CBE6F2",
    "collapsed": false,
    "children": [ /* … */ ]
  },
  "links": [{ "from": "id1", "to": "id2", "label": "feeds" }]
}
```

### HTTP API

| Method   | Path             | Purpose                                    |
| -------- | ---------------- | ------------------------------------------ |
| `GET`    | `/api/health`    | Liveness check                             |
| `GET`    | `/api/docs`      | List saved maps (metadata)                 |
| `GET`    | `/api/docs/:id`  | Fetch a map                                |
| `PUT`    | `/api/docs/:id`  | Create or overwrite a map                  |
| `POST`   | `/api/docs`      | Create a map with a server-generated id    |
| `DELETE` | `/api/docs/:id`  | Delete a map                               |
| `POST`   | `/api/export`    | Render `{ svg, format, scale }` to a file  |

`/api/export` formats: `png`, `jpeg`, `gif`, `bmp`, `tiff`, `pdf`. SVG, text, CSV, and FreeMind
exports are produced in the browser.

## Keyboard shortcuts

| Key                 | Action                         |
| ------------------- | ------------------------------ |
| `Tab`               | Add child topic                |
| `Enter`             | Add sibling topic              |
| `F2` / double-click | Rename topic                   |
| `Delete`            | Delete topic (and its branch)  |
| `Space`             | Collapse / expand branch       |
| Arrow keys          | Move selection                 |
| `Ctrl/Cmd + Z` / `Y`| Undo / redo                    |
| `+` / `−` / `0`     | Zoom in / out / fit            |
| `Ctrl/Cmd + S`      | Save to server                 |
| `Ctrl/Cmd + F`      | Find & replace                 |

## License

MIT.
