/**
 * Converts HTTP API request body (sheets, parts, config) into the payload shape
 * expected by background.js (background-start / server-nest-request).
 * Used only in server mode.
 */

const DEFAULT_CONFIG = {
  clipperScale: 10000000,
  curveTolerance: 0.3,
  spacing: 0,
  rotations: 4,
  placementType: "gravity",
  mergeLines: true,
  timeRatio: 0.5,
  scale: 72,
  simplify: false,
  overlapTolerance: 0.0001,
  endpointTolerance: 0.1,
  units: "mm",
  dxfImportScale: 1,
  dxfExportScale: 1,
  conversionServer: "https://converter.deepnest.app/convert",
  /** Server-mode GA: population size (individuals per generation). */
  populationSize: 10,
  mutationRate: 10,
  /** Server-mode GA: number of generations to evolve after the first evaluation pass. */
  gaGenerations: 3,
};

/**
 * Build a rectangle polygon (outline only) for a sheet.
 * Points in order: bottom-left, bottom-right, top-right, top-left (or equivalent closed loop).
 */
function rectSheet(width, height) {
  const poly = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  return poly;
}

/**
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @param {{ x: number, y: number }} c
 */
function crossOrient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * True if closed segments ab and cd intersect at a point interior to both (not only shared endpoints).
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @param {{ x: number, y: number }} c
 * @param {{ x: number, y: number }} d
 */
function segmentsProperIntersect(a, b, c, d) {
  const o1 = crossOrient(a, b, c);
  const o2 = crossOrient(a, b, d);
  const o3 = crossOrient(c, d, a);
  const o4 = crossOrient(c, d, b);
  const eps = 1e-12;
  if (
    (o1 > eps && o2 > eps) ||
    (o1 < -eps && o2 < -eps) ||
    (o3 > eps && o4 > eps) ||
    (o3 < -eps && o4 < -eps)
  ) {
    return false;
  }
  if (Math.abs(o1) <= eps && Math.abs(o2) <= eps && Math.abs(o3) <= eps && Math.abs(o4) <= eps) {
    return false;
  }
  return true;
}

/**
 * Shoelace area; sign indicates winding.
 * @param {Array<{ x: number, y: number }>} ring
 */
function polygonSignedArea(ring) {
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i].x * ring[j].y - ring[j].x * ring[i].y;
  }
  return a / 2;
}

/**
 * @param {Array<{ x: number, y: number }>} ring
 * @param {string} label - for error messages
 * @returns {string|null} error message or null if ok
 */
function validateClosedRing(ring, label) {
  if (!ring || !Array.isArray(ring) || ring.length < 3) {
    return `${label}: outline must be an array of at least 3 points with x,y`;
  }
  const pts = [];
  for (let k = 0; k < ring.length; k++) {
    const p = ring[k];
    const x = Number(p.x);
    const y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return `${label}: all outline points must have finite numeric x and y`;
    }
    pts.push({ x, y });
  }
  const area = polygonSignedArea(pts);
  if (Math.abs(area) < 1e-18) {
    return `${label}: outline has zero or degenerate area`;
  }
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const c = pts[j];
      const d = pts[(j + 1) % n];
      if (i === j) continue;
      if ((i + 1) % n === j || (j + 1) % n === i) continue;
      if (segmentsProperIntersect(a, b, c, d)) {
        return `${label}: outline is self-intersecting`;
      }
    }
  }
  return null;
}

/**
 * @param {Array} holesApi
 * @param {string} label
 * @returns {{ holes: Array<Array<{x:number,y:number}>>|null, error?: string }}
 */
function parseSheetHoles(holesApi, label) {
  if (holesApi == null || holesApi === undefined) {
    return { holes: null };
  }
  if (!Array.isArray(holesApi)) {
    return { holes: null, error: `${label}: holes must be an array` };
  }
  const out = [];
  for (let h = 0; h < holesApi.length; h++) {
    const hole = holesApi[h];
    const err = validateClosedRing(hole, `${label} hole ${h}`);
    if (err) {
      return { holes: null, error: err };
    }
    out.push(hole.map((p) => ({ x: Number(p.x), y: Number(p.y) })));
  }
  return { holes: out.length ? out : null };
}

/**
 * One API sheet → outer polygon (array of points) + optional hole rings for sheetchildren.
 * @param {object} s - API sheet entry
 * @param {number} i - index for errors
 * @returns {{ poly: Array<{x:number,y:number}>, sheetChildren: Array|undefined, error?: string }}
 */
function cloneRing(ring) {
  return ring.map((p) => ({ x: p.x, y: p.y }));
}

function cloneSheetChildren(children) {
  if (!children || !Array.isArray(children)) return undefined;
  return children.map((hole) => cloneRing(hole));
}

function sheetApiToPolygon(s, i) {
  const label = `Sheet ${i}`;
  const outline = s.outline;
  const hasOutline = Array.isArray(outline) && outline.length >= 3;

  if (hasOutline) {
    const errRing = validateClosedRing(outline, label);
    if (errRing) {
      return { poly: [], sheetChildren: undefined, error: errRing };
    }
    const { holes, error: holeErr } = parseSheetHoles(s.holes, label);
    if (holeErr) {
      return { poly: [], sheetChildren: undefined, error: holeErr };
    }
    const poly = outline.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
    return { poly, sheetChildren: holes || undefined };
  }

  const w = Number(s.width);
  const h = Number(s.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return {
      poly: [],
      sheetChildren: undefined,
      error: `${label}: provide width and height (positive numbers), or outline with at least 3 points`,
    };
  }
  return { poly: rectSheet(w, h), sheetChildren: undefined };
}

/**
 * Build internal part polygon from API part: { outline: [{x,y}], holes?: [[{x,y}]], quantity?: number }.
 * Returns array of part polygons (one per copy when quantity > 1), each with .id, .source, .filename, .children.
 */
function buildPartPolygons(apiPart, startId, sourceIndex, filename) {
  const outline = apiPart.outline;
  const holes = apiPart.holes || [];
  const quantity = Math.max(1, parseInt(apiPart.quantity, 10) || 1);

  if (!outline || !Array.isArray(outline) || outline.length < 3) {
    return null;
  }

  const canRotate = apiPart.canRotate !== false;
  const result = [];
  for (let q = 0; q < quantity; q++) {
    const poly = outline.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
    poly.id = startId + q;
    poly.source = sourceIndex;
    poly.filename = filename || `part-${sourceIndex}`;
    poly.canRotate = canRotate;
    poly.children = holes.length
      ? holes.map((hole) => hole.map((p) => ({ x: Number(p.x), y: Number(p.y) })))
      : undefined;
    result.push(poly);
  }
  return result;
}

/**
 * Convert API request body to background-start payload.
 * @param {object} body - { sheets: [{ width, height }], parts: [{ outline, holes?, quantity? }], config?: object }
 * @returns {{ payload: object, error?: string }}
 */
function apiToBackgroundPayload(body) {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be a JSON object" };
  }

  const sheetsApi = body.sheets;
  const partsApi = body.parts;
  const configOverrides = body.config || {};

  if (!Array.isArray(sheetsApi) || sheetsApi.length === 0) {
    return { error: "sheets must be a non-empty array" };
  }
  if (!Array.isArray(partsApi) || partsApi.length === 0) {
    return { error: "parts must be a non-empty array" };
  }

  const config = { ...DEFAULT_CONFIG, ...configOverrides };

  const sheets = [];
  const sheetids = [];
  const sheetsources = [];
  const sheetchildren = [];
  let sid = 0;
  for (let i = 0; i < sheetsApi.length; i++) {
    const s = sheetsApi[i];
    const built = sheetApiToPolygon(s, i);
    if (built.error) {
      return { error: built.error };
    }
    const polyTemplate = built.poly;
    const sheetChildrenTemplate = built.sheetChildren;
    const qty = Math.max(1, parseInt(s.quantity, 10) || 1);
    for (let j = 0; j < qty; j++) {
      sheets.push(cloneRing(polyTemplate));
      sheetids.push(String(sid).padStart(4, "0") + "-" + String(j).padStart(4, "0"));
      sheetsources.push(i);
      sheetchildren.push(cloneSheetChildren(sheetChildrenTemplate));
    }
    sid++;
  }

  const placement = [];
  const rotations = [];
  const ids = [];
  const sources = [];
  const children = [];
  const filenames = [];
  let nextId = 0;

  for (let i = 0; i < partsApi.length; i++) {
    const partPolygons = buildPartPolygons(
      partsApi[i],
      nextId,
      i,
      partsApi[i].filename || `part-${i}`
    );
    if (!partPolygons) {
      return { error: `Part ${i}: outline must be an array of at least 3 points with x,y` };
    }
    for (const p of partPolygons) {
      placement.push(p);
      rotations.push(0);
      ids.push(p.id);
      sources.push(p.source);
      children.push(p.children);
      filenames.push(p.filename);
      nextId++;
    }
  }

  if (placement.length === 0) {
    return { error: "No parts to place" };
  }

  const individual = {
    placement,
    rotation: rotations,
  };

  const payload = {
    index: 0,
    sheets,
    sheetids,
    sheetsources,
    sheetchildren,
    individual,
    config,
    ids,
    sources,
    children,
    filenames,
  };

  return { payload };
}

/**
 * Map placeParts result (from background) to API response shape.
 */
function placementToApiResponse(placement) {
  if (!placement) {
    return { error: "No placement result" };
  }
  return {
    fitness: placement.fitness != null ? placement.fitness : 0,
    area: placement.area ?? 0,
    totalarea: placement.totalarea ?? 0,
    mergedLength: placement.mergedLength ?? 0,
    utilisation: placement.utilisation != null ? placement.utilisation : 0,
    placements: placement.placements || [],
  };
}

module.exports = {
  apiToBackgroundPayload,
  placementToApiResponse,
  DEFAULT_CONFIG,
};
