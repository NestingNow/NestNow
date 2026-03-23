/**
 * Unit tests for server-adapter sheet parsing (rect + polygon outline).
 * Run: node tests/server-adapter-polygon-sheets.cjs
 */

const assert = require("assert");
const { apiToBackgroundPayload } = require("../server-adapter.js");

function ok(cond, msg) {
  assert.strictEqual(cond, true, msg);
}

const rectBody = {
  sheets: [{ width: 100, height: 200 }],
  parts: [
    {
      outline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      quantity: 1,
    },
  ],
};

const polySheetBody = {
  sheets: [
    {
      outline: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 80, y: 60 },
        { x: 20, y: 60 },
      ],
      quantity: 1,
    },
  ],
  parts: rectBody.parts,
};

// Bowtie — zero signed area (degenerate), rejected before edge checks
const bowtieSheet = {
  sheets: [
    {
      outline: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
        { x: 1, y: 0 },
      ],
    },
  ],
  parts: rectBody.parts,
};

{
  const { payload, error } = apiToBackgroundPayload(rectBody);
  ok(!error, error || "rect");
  ok(payload.sheets.length === 1, "one rect sheet");
  ok(payload.sheets[0].length === 4, "rect has 4 verts");
}

{
  const { payload, error } = apiToBackgroundPayload(polySheetBody);
  ok(!error, error || "poly sheet");
  ok(payload.sheets.length === 1, "one poly sheet");
  ok(payload.sheets[0].length === 4, "poly 4 verts");
  ok(payload.sheetchildren[0] === undefined, "no holes");
}

{
  const { error } = apiToBackgroundPayload(bowtieSheet);
  ok(!!error, "bowtie should fail");
  ok(
    String(error).includes("degenerate") || String(error).includes("zero"),
    "bowtie degenerate area",
  );
}

{
  const { error } = apiToBackgroundPayload({
    sheets: [{ width: -1, height: 10 }],
    parts: rectBody.parts,
  });
  ok(!!error, "bad width");
}

{
  const qty2 = {
    sheets: [{ width: 10, height: 10, quantity: 2 }],
    parts: rectBody.parts,
  };
  const { payload, error } = apiToBackgroundPayload(qty2);
  ok(!error, error);
  ok(payload.sheets.length === 2, "qty 2 => two sheets");
  ok(payload.sheets[0] !== payload.sheets[1], "distinct poly refs");
}

{
  const withHole = {
    sheets: [
      {
        outline: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        holes: [
          [
            { x: 40, y: 40 },
            { x: 60, y: 40 },
            { x: 60, y: 60 },
            { x: 40, y: 60 },
          ],
        ],
      },
    ],
    parts: rectBody.parts,
  };
  const { payload, error } = apiToBackgroundPayload(withHole);
  ok(!error, error);
  ok(Array.isArray(payload.sheetchildren[0]), "hole children");
  ok(payload.sheetchildren[0].length === 1, "one hole");
}

{
  const { payload: built } = apiToBackgroundPayload(rectBody);
  const pid = built.individual.placement[0].id;
  const outline = rectBody.parts[0].outline;
  const chromBody = {
    sheets: rectBody.sheets,
    parts: rectBody.parts,
    chromosome: {
      placement: [{ id: pid, outline: outline.map((p) => ({ x: p.x, y: p.y })) }],
      rotation: [90],
    },
    config: { rotations: 4 },
  };
  const { payload, error } = apiToBackgroundPayload(chromBody);
  ok(!error, error);
  ok(payload.seedChromosome === true, "seedChromosome flag");
  ok(payload.individual.rotation[0] === 90, "snapped rotation 90");
}

{
  const twoPartsBody = {
    sheets: rectBody.sheets,
    parts: [
      rectBody.parts[0],
      {
        outline: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
        quantity: 1,
      },
    ],
  };
  const { payload: p2 } = apiToBackgroundPayload(twoPartsBody);
  const a = p2.individual.placement[0];
  const b = p2.individual.placement[1];
  const chromSwap = {
    sheets: twoPartsBody.sheets,
    parts: twoPartsBody.parts,
    chromosome: {
      placement: [
        { id: b.id, outline: b.map((pt) => ({ x: pt.x, y: pt.y })) },
        { id: a.id, outline: a.map((pt) => ({ x: pt.x, y: pt.y })) },
      ],
      rotation: [0, 180],
    },
    config: { rotations: 4 },
  };
  const { payload: swapped, error: e2 } = apiToBackgroundPayload(chromSwap);
  ok(!e2, e2);
  ok(swapped.individual.placement[0].id === b.id, "chromosome order: first slot is part b");
  ok(swapped.individual.placement[1].id === a.id, "chromosome order: second slot is part a");
  ok(swapped.individual.rotation[0] === 0 && swapped.individual.rotation[1] === 180, "rotations");
}

{
  const bad = {
    sheets: rectBody.sheets,
    parts: rectBody.parts,
    chromosome: { placement: [], rotation: [] },
  };
  const { error } = apiToBackgroundPayload(bad);
  ok(!!error, "empty chromosome should fail");
}

console.log("server-adapter-polygon-sheets: ok");
