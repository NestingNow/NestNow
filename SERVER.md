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
- **NESTNOW_REQUEST_TIMEOUT_MS** – Default per-evaluation timeout when the client omits `requestTimeoutMs` (default 600000 ms = 10 minutes).
- **NESTNOW_TOP_K** – Max layouts returned in `candidates` (default 3, max 20).
- **NESTNOW_GA_MAX_EVALS** – Optional hard cap on genetic evaluations per request. If **unset**, the limit is `populationSize × gaGenerations` from the request config, **capped at 10 million** and **floored at 500** (so tiny GA settings still get the old 500-eval minimum). If **set**, this value is used instead (max **50 million**). Each generation evaluates up to `populationSize` individuals (sequentially).
- **NESTNOW_DISABLE_GA** – Set to `1` to skip the genetic loop.
- **NESTNOW_SERVER_PROGRESS** – Set to `1` to log GA progress lines to the console.

The server binds to `127.0.0.1` only (local host). You should see:

```
NestNow server mode: http://127.0.0.1:3001 (GET /progress, POST /nest, POST /stop)
```

## API

### POST /nest

Accepts a JSON body with sheets, parts, optional config, optional per-request timeout, and optional `chromosome` seed. Returns the best nesting result; with multi-layout search enabled, also returns `candidates` and `chromosome` snapshots when available.

#### Request body

| Field   | Type   | Required | Description |
|--------|--------|----------|-------------|
| sheets | array  | yes      | Sheet definitions (rectangle and/or polygon outline). |
| parts  | array  | yes      | Part definitions (polygons). |
| config | object | no       | Override nesting config (see below). |
| requestTimeoutMs | number | no | Per-layout-evaluation timeout in ms (server clamps to a safe range). |
| chromosome | object | no | **Phase 2 seed.** When present, the GA initial population is seeded from this individual instead of a random start. Shape matches the response `chromosome`: `placement` is an array of **`{ id, outline }`** objects (one per gene, in GA order; `id` is the expanded part id from NestNow; `outline` is ignored for geometry—vertices always come from the current request so shapes stay aligned), plus `rotation` (degrees per slot, snapped to `config.rotations`). Legacy clients may send raw outline rings at each index (API part order only). Length must match expanded part count or the server returns **400**. |

**Sheets** – Each element is either:

**A) Rectangle (legacy)** – `width` and `height` (both positive numbers, same units as parts). The server builds the standard closed polygon in **Nest coordinates**: origin at bottom-left, **y increases upward**, vertices in order bottom-left → bottom-right → top-right → top-left (same convention as part outlines).

**B) Polygon remnant** – `outline`: array of at least three `{ x, y }` points forming a closed outer boundary (same coordinate system as parts). Optional `holes`: array of hole rings, each an array of `{ x, y }` points. The outline must have non-zero area and must not be self-intersecting.

For each sheet you must provide **either** (`width` + `height`) **or** a valid `outline`. If both are present, **`outline` takes precedence**.

Common to both:

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
| candidates   | array  | Optional. Up to **K** merged layouts (same shape as top-level metrics + `placements`), best first: **top-K** hits from the search plus **one snapshot per completed GA round** (improvement round), sorted by fitness, deduped when fitness ties within a small epsilon. See **NESTNOW_TOP_K** above. |
| chromosome   | object | Optional. Present when the server captured the GA individual: `placement` as **`{ id, outline }[]`** (GA order; `outline` mirrors part shape) and `rotation` (degrees per slot). POST the same JSON back to re-seed Refine. |

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

## Genetic search and multiple layouts

- With **`populationSize` ≥ 2** (default 10), the server runs a **genetic search** over part orderings and rotations across **`gaGenerations`** rounds (default 3). Each individual layout is still subject to the per-evaluation timeout (`requestTimeoutMs` in the body, or NestNow defaults).
- The JSON response includes the **best** layout in the top-level fields (`fitness`, `placements`, …). Successful GA runs also attach **`chromosome`** on the top-level result and on **`candidates`** entries when available (part order + discrete rotations used for that layout). It may also include **`candidates`**: up to **K** entries merging (1) layouts from the in-search top list with (2) the **best-so-far at the end of each GA round**, sorted by fitness (lower is better), deduped by fitness. **`K`** is set with env **`NESTNOW_TOP_K`** (default **3**, maximum **20**).
- Optional request **`chromosome`** (same shape) seeds the genetic algorithm’s first individual for **exploitation** runs (e.g. Keystone “Refine”); part count/order must match the expanded request parts.
- Eval budget per request: if **`NESTNOW_GA_MAX_EVALS`** is unset, it is **`populationSize × gaGenerations`** (max **10M**, min **500**). If the env var is set, it overrides (max **50M**). **`NESTNOW_DISABLE_GA=1`** forces a single placement pass (no genetic loop).

## GET /progress

While a **`POST /nest`** job is running, poll:

```http
GET http://127.0.0.1:3001/progress
```

Response JSON:

| Field | Description |
|-------|-------------|
| `busy` | `true` while a nest is in progress. |
| `placement` | Current single-evaluation progress (`index`, `progress` 0–1) when the worker reports NFP/placement phases. |
| `ga` | Genetic search position: `gen`, `generations`, `idx`, `pop`, `evalCount`. |
| `bestSoFar` | After each completed GA **improvement round** (generation), the global best layout so far — same core fields as a successful `/nest` body (for live UI preview). Omitted until a round finishes with at least one valid layout. |
| `updatedAt` | Server timestamp (ms). |

## Scope

- **JSON only** – No file upload or multipart; clients send part geometry as JSON. File-based or SVG upload can be added later.

## Integration (e.g. keystone-pms)

From the same host, call:

```http
POST http://127.0.0.1:3001/nest
Content-Type: application/json

{ "sheets": [...], "parts": [...] }
```

Handle 4xx/5xx and parse the JSON response for placements and metrics.

## Fresh machine checklist (local dev)

On a new Mac or Windows machine:

1. Install prerequisites from `BUILD.md` (Node 20+, build tools).
2. Clone the repo:

   ```sh
   git clone https://github.com/NestingNow/NestNow.git
   cd NestNow
   ```

3. Install dependencies (this also rebuilds native modules via `postinstall`):

   ```sh
   npm install
   ```

4. Build the app (TypeScript compile + Electron deps):

   ```sh
   npm run build
   ```

5. Start the server:

   ```sh
   npm run start:server
   ```

6. Confirm you see:

   ```text
   NestNow server mode: POST http://127.0.0.1:3001/nest
   ```

7. In your Keystone PMS `.env.local`, set (or confirm) `NESTNOW_URL`:

   ```env
   NESTNOW_URL=http://127.0.0.1:3001
   ```

At this point, Keystone PMS should be able to call the NestNow server on `POST /nest`.

## Mixed rectangles + circles (regression)

If `POST /nest` returns `500` with `lastEvalError` like `Cannot read properties of null (reading 'x')`, ensure you are on a build that includes the `placeParts` first-placement guard (do not push `null` into `placements` when the inner NFP has no usable vertices).

With the server running locally:

```sh
npm run test:nest-circles-regression
```

By default the script **skips** if nothing is listening on the port. To fail CI when the server is missing or the nest fails, set `NESTNOW_CIRCLES_PROBE_REQUIRE=1`.

## Troubleshooting server startup

- **Server does not log \"NestNow server mode\" or Keystone PMS requests hang**
  - Stop NestNow.
  - From the NestNow repo root, run:

    ```sh
    npm run clean
    npm run build
    npm run start:server
    ```

- **Still broken or you suspect a stale `node_modules`**

  ```sh
  npm run clean-all
  npm install
  npm run build
  npm run start:server
  ```

If problems persist on a specific machine, verify Node version (`node -v`), that build tools are installed (see `BUILD.md`), and that no firewall is blocking `127.0.0.1:3001`.
