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
    const w = Number(s.width);
    const h = Number(s.height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return { error: `Sheet ${i}: width and height must be positive numbers` };
    }
    const poly = rectSheet(w, h);
    const qty = Math.max(1, parseInt(s.quantity, 10) || 1);
    for (let j = 0; j < qty; j++) {
      sheets.push(poly);
      sheetids.push(String(sid).padStart(4, "0") + "-" + String(j).padStart(4, "0"));
      sheetsources.push(i);
      sheetchildren.push(poly.children);
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
