# NestNow server mode

NestNow can run as a headless HTTP service for integration with other apps (e.g. keystone-pms). No Electron UI is shown; the nesting engine runs in a background process and exposes a single HTTP endpoint.

## Running the server

```sh
npm run start:server
```

Or with Electron directly:

```sh
electron . --server
```

Environment variables:

- **NESTNOW_PORT** – Port for the HTTP server (default: `3001`)
- **NESTNOW_SERVER** – If set to `1`, enables server mode even without `--server` (e.g. `NESTNOW_SERVER=1 electron .`)

The server binds to `127.0.0.1` only (local host). You should see:

```
NestNow server mode: POST http://127.0.0.1:3001/nest
```

## API

### POST /nest

Accepts a JSON body with sheets, parts, and optional config. Returns a single nesting result (one placement run; no genetic algorithm in this version).

#### Request body

| Field   | Type   | Required | Description |
|--------|--------|----------|-------------|
| sheets | array  | yes      | Sheet definitions (rectangular). |
| parts  | array  | yes      | Part definitions (polygons). |
| config | object | no       | Override nesting config (see below). |

**Sheets** – Each element:

- `width` (number) – Sheet width in the same units as parts (e.g. mm).
- `height` (number) – Sheet height.
- `quantity` (number, optional) – Number of identical sheets (default: 1).

**Parts** – Each element:

- `outline` (array) – Polygon outline as an array of points `{ x, y }` (at least 3 points).
- `holes` (array, optional) – Array of hole polygons, each an array of `{ x, y }` points.
- `quantity` (number, optional) – Number of copies of this part (default: 1).
- `filename` (string, optional) – Label for the part (e.g. for exports); default `part-&lt;index&gt;`.

**Config** – Optional overrides. Omitted keys use NestNow defaults. Common options:

- `spacing` (number) – Gap between parts (default: 0).
- `rotations` (number) – Number of rotation angles to try, e.g. 4 = 0°, 90°, 180°, 270° (default: 4).
- `placementType` (string) – `"gravity"` \| `"box"` \| `"convexhull"` (default: `"gravity"`).
- `curveTolerance` (number), `mergeLines` (boolean), `timeRatio` (number), etc.

#### Response (200)

JSON body:

| Field        | Type   | Description |
|--------------|--------|-------------|
| fitness      | number | Nesting score (lower is better). |
| area         | number | Total area used by placed parts. |
| totalarea    | number | Total sheet area used. |
| mergedLength | number | Merged cut length (if mergeLines enabled). |
| utilisation  | number | Utilization percentage (0–100). |
| placements   | array  | Per-sheet placements (see below). |

**placements** – Array of:

- `sheet` (number) – Sheet index.
- `sheetid` (number) – Sheet id.
- `sheetplacements` (array) – Each element: `{ filename, id, rotation, source, x, y }` (position and rotation of each part on that sheet).

#### Error responses

- **400** – Invalid JSON or validation error (e.g. missing/invalid `sheets` or `parts`). Body: `{ "error": "message" }`.
- **404** – Method or path not supported. Body: `{ "error": "Not found. Use POST /nest" }`.
- **500** – Nesting failed or internal error. Body: `{ "error": "message" }`.
- **503** – No worker available or previous request still in progress. Body: `{ "error": "message" }`.

#### Example request

```json
{
  "sheets": [
    { "width": 1200, "height": 2400 }
  ],
  "parts": [
    {
      "outline": [
        { "x": 0, "y": 0 },
        { "x": 100, "y": 0 },
        { "x": 100, "y": 50 },
        { "x": 0, "y": 50 }
      ],
      "quantity": 3,
      "filename": "bracket.svg"
    }
  ],
  "config": {
    "spacing": 2,
    "rotations": 4
  }
}
```

#### Example response (200)

```json
{
  "fitness": 5000,
  "area": 15000,
  "totalarea": 2880000,
  "mergedLength": 0,
  "utilisation": 0.52,
  "placements": [
    {
      "sheet": 0,
      "sheetid": 0,
      "sheetplacements": [
        { "filename": "bracket.svg", "id": 0, "rotation": 0, "source": 0, "x": 0, "y": 0 },
        { "filename": "bracket.svg", "id": 1, "rotation": 0, "source": 0, "x": 102, "y": 0 },
        { "filename": "bracket.svg", "id": 2, "rotation": 0, "source": 0, "x": 204, "y": 0 }
      ]
    }
  ]
}
```

## Scope of this version

- **Single placement per request** – One run of the placement algorithm with a fixed part order and rotation set (no genetic algorithm). Suitable for integration and testing; a future version may add GA or multiple candidate results.
- **JSON only** – No file upload or multipart; clients send part geometry as JSON. File-based or SVG upload can be added later.

## Integration (e.g. keystone-pms)

From the same host, call:

```http
POST http://127.0.0.1:3001/nest
Content-Type: application/json

{ "sheets": [...], "parts": [...] }
```

Handle 4xx/5xx and parse the JSON response for placements and metrics.
