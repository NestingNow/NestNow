"use strict";

const assert = require("assert");
const {
  payloadForIndividual,
  nestTemplateFromPayload,
  clonePolygon,
  runServerGeneticNesting,
} = require("../server-ga.js");

const samplePayload = {
  index: 0,
  sheets: [
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  ],
  sheetids: ["0000-0000"],
  sheetsources: [0],
  sheetchildren: [null],
  individual: {
    placement: [],
    rotation: [],
  },
  config: {
    clipperScale: 10000000,
    curveTolerance: 0.3,
    spacing: 0,
    rotations: 4,
    populationSize: 2,
    mutationRate: 10,
    gaGenerations: 1,
    placementType: "gravity",
    mergeLines: true,
  },
  ids: [0, 1],
  sources: [0, 0],
  children: [undefined, undefined],
  filenames: ["a", "a"],
};

samplePayload.individual.placement = [
  Object.assign(
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    { id: 0, source: 0, filename: "a" },
  ),
  Object.assign(
    [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ],
    { id: 1, source: 0, filename: "a" },
  ),
];
samplePayload.individual.rotation = [0, 0];

const tpl = nestTemplateFromPayload(samplePayload);
const ind = {
  placement: samplePayload.individual.placement.map(clonePolygon),
  rotation: [0, 45],
};
const built = payloadForIndividual(tpl, ind);
assert.strictEqual(built.individual.placement.length, 2);
assert.strictEqual(built.sources.join(","), "0,0");
assert.deepStrictEqual(built.individual.rotation, [0, 45]);
assert.notStrictEqual(
  built.individual.placement[0][0],
  samplePayload.individual.placement[0][0],
  "clone should not alias vertex objects",
);

(async () => {
  let calls = 0;
  const { result, evalCount } = await runServerGeneticNesting(samplePayload, {
    runSingle: async () => {
      calls++;
      return { fitness: 100 - calls, placements: [], utilisation: 0 };
    },
  });
  assert.ok(calls >= 2, "GA should evaluate at least 2 individuals");
  assert.strictEqual(evalCount, calls);
  assert.strictEqual(result.fitness, 98);
  process.stdout.write("server-ga-smoke: ok\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
