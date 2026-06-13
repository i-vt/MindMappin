# Programmatic JSON Reference

A complete reference for generating `.json` map files that can be ingested into the
Blumind Web dashboard via file-system drop or the HTTP API.

---

## 1. Top-level Map Object

```json
{
  "id":     "my-map-001",
  "title":  "Q3 Roadmap",
  "layout": "mindmap",
  "theme":  "blueprint",
  "root":   { /* Node — see §2 */ },
  "links":  [ /* CrossLink[] — see §3 */ ]
}
```

| Field    | Type     | Required | Default         | Notes |
|----------|----------|----------|-----------------|-------|
| `id`     | string   | Yes (API PUT) / No (API POST) | server UUID | Must match `/^[A-Za-z0-9_-]{1,64}$/`. Becomes the filename (`<id>.json`) on disk. |
| `title`  | string   | No       | `"Imported map"` | Shown in the Open dialog and tab bar. |
| `layout` | string   | No       | `"mindmap"`     | See §4 for valid values. |
| `theme`  | string   | No       | `"blueprint"`   | See §5 for valid values. |
| `root`   | Node     | **Yes**  | —               | The server returns `400` if absent. |
| `links`  | CrossLink[] | No    | `[]`            | Cross-topic connections (non-parent/child edges). |

---

## 2. Node Object

Every entry in the tree — including the root — uses this shape.
`format.js › newNode()` defines the canonical defaults:

```json
{
  "id":        "n4z8kxqm",
  "text":      "Core features",
  "color":     "#CBE6F2",
  "icon":      "rocket",
  "progress":  40,
  "note":      "### Notes\n\nMarkdown is supported here.",
  "link":      "https://example.com",
  "collapsed": false,
  "children":  [ /* Node[] */ ]
}
```

| Field       | Type            | Default  | Notes |
|-------------|-----------------|----------|-------|
| `id`        | string          | auto uid | Unique across the whole map. Format used by the app: `"n"` + 8 random base-36 chars. Collisions are your responsibility when generating IDs programmatically. |
| `text`      | string          | `""`     | The visible label. |
| `color`     | string          | `""`     | Empty string = theme default. Otherwise a CSS hex color. The built-in color picker swatches are listed in §6; any valid hex is accepted. |
| `icon`      | string          | `""`     | Empty string = no icon. Valid icon IDs listed in §7. |
| `progress`  | number \| null  | `null`   | `null` hides the progress bar. Integers `0`–`100` render a filled bar. |
| `note`      | string          | `""`     | Per-topic Markdown. Rendered in the inspector's Preview tab. |
| `link`      | string          | `""`     | A clickable URL attached to the topic. |
| `collapsed` | boolean         | `false`  | `true` hides all children in the canvas. |
| `children`  | Node[]          | `[]`     | Ordered child nodes. Depth is unlimited. |

### Normalization behavior (`fromJSON`)

The dashboard's `fromJSON()` parser is lenient — missing or `null`/`undefined` fields
are silently replaced with their defaults. You only need to supply the fields you care
about. The **only field with no default is `root`** (required by both parser and server).

---

## 3. CrossLink Object

Draws a labelled edge between any two topics regardless of their parent/child relationship.

```json
{ "from": "n4z8kxqm", "to": "nabc12345", "label": "feeds into" }
```

| Field   | Type   | Required | Notes |
|---------|--------|----------|-------|
| `from`  | string | Yes      | `id` of the source node. |
| `to`    | string | Yes      | `id` of the target node. |
| `label` | string | No       | Shown on the connecting arrow. Empty string = unlabelled. |

Both `from` and `to` must reference node IDs that exist in the tree. Dangling
references are rendered as `(missing)` in the inspector but do not crash the dashboard.

---

## 4. Layout Values

| Value      | Renders as |
|------------|-----------|
| `"mindmap"` | Radial — branches spread in all directions from the root. |
| `"tree"`    | Top-down tree (root at top). |
| `"org"`     | Org-chart (same as tree with a boxier node style). |
| `"logic"`   | Left-to-right horizontal flow. |

Switching layout in the dashboard re-flows the same data instantly — the stored
value just sets the default view when the map is opened.

---

## 5. Theme Values

| Value        | Description |
|--------------|-------------|
| `"blueprint"` | Light blue-grey. Default for light mode. |
| `"paper"`     | Warm cream tones. |
| `"slate"`     | Dark navy. Default for dark mode. |
| `"meadow"`    | Light green. |
| `"grape"`     | Light purple. |
| `"mono"`      | Greyscale. |

The theme sets the canvas background, grid, default node fill, and edge colors.
Individual nodes can override their fill with `node.color` (§6) regardless of theme.

---

## 6. Node Color Swatches

These are the colors available in the inspector's color-picker.
Any CSS hex string is valid in `node.color`; the swatches are the curated set:

| Swatch | Hex value   |
|--------|-------------|
| Default (theme fill) | `""` |
| Peach  | `"#FFD9C7"` |
| Warm yellow | `"#FFE9B8"` |
| Pale yellow | `"#FFF6BF"` |
| Light green | `"#DDF0CB"` |
| Mint   | `"#C9E9DD"` |
| Sky blue | `"#CBE6F2"` |
| Lavender | `"#DCD3F2"` |
| Rose   | `"#F6D2E1"` |
| Tan    | `"#E7E0CF"` |
| Cool grey | `"#E2E6E9"` |

---

## 7. Icon ID Reference

| ID          | Emoji | Label    |
|-------------|-------|----------|
| `""`        | —     | None (clear icon) |
| `"star"`    | ⭐    | Star |
| `"flag"`    | 🚩    | Flag |
| `"check"`   | ✅    | Done |
| `"cross"`   | ❌    | Blocked |
| `"warn"`    | ⚠️    | Warning |
| `"question"`| ❓    | Question |
| `"idea"`    | 💡    | Idea |
| `"fire"`    | 🔥    | Hot |
| `"pin"`     | 📌    | Pinned |
| `"calendar"`| 📅    | Date |
| `"clock"`   | ⏰    | Time |
| `"target"`  | 🎯    | Goal |
| `"rocket"`  | 🚀    | Launch |
| `"bug"`     | 🐞    | Bug |
| `"money"`   | 💰    | Cost |
| `"people"`  | 👥    | Team |
| `"heart"`   | ❤️    | Favorite |
| `"smile"`   | 🙂    | Smile |
| `"frown"`   | 🙁    | Concern |
| `"up"`      | ⬆️    | Up |
| `"down"`    | ⬇️    | Down |
| `"note"`    | 📝    | Note |
| `"lock"`    | 🔒    | Locked |

An unrecognised icon ID is silently ignored (the node renders without an icon).

---

## 8. ID Generation

The app's own uid helper (from `format.js`):

```js
const uid = () => "n" + Math.random().toString(36).slice(2, 10);
// → "n4z8kxqm", "nabc12def", …
```

Python equivalent:

```python
import random, string

def uid():
    chars = string.digits + string.ascii_lowercase
    return "n" + "".join(random.choices(chars, k=8))
```

Node/map IDs only need to be unique within a single map file.
The server-level `safeId` constraint (`/^[A-Za-z0-9_-]{1,64}$/`) applies only to
**map** IDs (i.e. the top-level `id` field and the URL path segment), **not** to
node IDs inside the tree.

---

## 9. HTTP API Ingestion

The server (`server.js`) exposes two write endpoints:

### POST /api/docs — server-assigned ID
```http
POST /api/docs
Content-Type: application/json

{ "title": "My map", "layout": "mindmap", "theme": "slate", "root": { ... }, "links": [] }
```
Returns `{ "id": "<uuid>" }`. Use this when you do not need to control the ID.

### PUT /api/docs/:id — caller-controlled ID
```http
PUT /api/docs/my-map-001
Content-Type: application/json

{ "title": "My map", "layout": "mindmap", "theme": "slate", "root": { ... }, "links": [] }
```
The `:id` must satisfy `/^[A-Za-z0-9_-]{1,64}$/`. Idempotent — repeated PUTs overwrite.
Returns `{ "id": "my-map-001", "savedAt": <epoch_ms> }`.

Both endpoints require the body to have a `root` field or they return `400`.

### Filesystem drop (no server running)
Drop the JSON file directly into the `DATA_DIR` (default `./data/`, or the Docker volume):

```
data/
  my-map-001.json
  another-map.json
```

The filename (without `.json`) becomes the map's `id`. The server reads it on the next
`GET /api/docs` call with no restart required.

---

## 10. Minimal Valid Map

The smallest document the server and parser will accept:

```json
{
  "root": { "text": "Start here" }
}
```

`fromJSON` fills in every omitted field. Useful as a template base for generators
that only need to set a subset of properties.

---

## 11. Full Example

```json
{
  "id": "sprint-42",
  "title": "Sprint 42",
  "layout": "tree",
  "theme": "meadow",
  "root": {
    "id": "n00000001",
    "text": "Sprint 42",
    "icon": "rocket",
    "color": "",
    "progress": null,
    "note": "",
    "link": "",
    "collapsed": false,
    "children": [
      {
        "id": "n00000002",
        "text": "Frontend",
        "icon": "star",
        "color": "#CBE6F2",
        "progress": 60,
        "note": "### Tickets\n- [ ] Modal redesign\n- [x] Dark mode",
        "link": "https://jira.example.com/board?sprint=42&component=FE",
        "collapsed": false,
        "children": [
          {
            "id": "n00000003",
            "text": "Modal redesign",
            "icon": "check",
            "color": "",
            "progress": 100,
            "note": "",
            "link": "",
            "collapsed": false,
            "children": []
          },
          {
            "id": "n00000004",
            "text": "Dark mode",
            "icon": "clock",
            "color": "#FFD9C7",
            "progress": 20,
            "note": "",
            "link": "",
            "collapsed": false,
            "children": []
          }
        ]
      },
      {
        "id": "n00000005",
        "text": "Backend",
        "icon": "bug",
        "color": "#DDF0CB",
        "progress": 80,
        "note": "",
        "link": "",
        "collapsed": false,
        "children": [
          {
            "id": "n00000006",
            "text": "Rate limiter",
            "icon": "warn",
            "color": "#FFE9B8",
            "progress": 80,
            "note": "Blocked on infra sign-off.",
            "link": "",
            "collapsed": false,
            "children": []
          }
        ]
      }
    ]
  },
  "links": [
    { "from": "n00000004", "to": "n00000006", "label": "shared CSS tokens" }
  ]
}
```
