/**
 * Genetic nesting search for HTTP server mode (main process).
 * Mirrors main/deepnest.js GeneticAlgorithm without renderer IPC.
 */

"use strict";

const { placementToApiResponse } = require("./server-adapter");

function polygonAreaSigned(poly) {
  var a = 0;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return a / 2;
}

function clonePolygon(poly) {
  var out = [];
  for (var i = 0; i < poly.length; i++) {
    out.push({ x: poly[i].x, y: poly[i].y });
  }
  out.id = poly.id;
  out.source = poly.source;
  out.filename = poly.filename;
  out.canRotate = poly.canRotate;
  if (poly.children) {
    out.children = poly.children.map(function (hole) {
      return hole.map(function (p) {
        return { x: p.x, y: p.y };
      });
    });
  }
  return out;
}

/**
 * JSON-serializable GA chromosome for Phase 2 seeding (part order + rotations).
 * Each placement entry is { id, source?, outline } so HTTP JSON preserves id
 * (plain ring arrays lose non-index properties) and Refine can reorder by id
 * while using fresh geometry from the current request.
 */
function serializeChromosomeFromIndividual(individual) {
  if (!individual || !individual.placement || !individual.rotation) return undefined;
  return {
    placement: individual.placement.map(function (poly) {
      return {
        id: poly.id,
        source: poly.source,
        outline: poly.map(function (pt) {
          return { x: pt.x, y: pt.y };
        }),
      };
    }),
    rotation: individual.rotation.slice(),
  };
}

function attachChromosomeToResult(result, individual) {
  if (!result || result.fitness == null || !individual) return;
  var c = serializeChromosomeFromIndividual(individual);
  if (c) result.chromosome = c;
}

function sortAdamByAreaDesc(placement) {
  return placement.slice().sort(function (a, b) {
    return Math.abs(polygonAreaSigned(b)) - Math.abs(polygonAreaSigned(a));
  });
}

function nestTemplateFromPayload(payload) {
  return {
    index: payload.index,
    sheets: JSON.parse(JSON.stringify(payload.sheets)),
    sheetids: payload.sheetids.slice(),
    sheetsources: payload.sheetsources.slice(),
    sheetchildren: JSON.parse(JSON.stringify(payload.sheetchildren)),
    config: Object.assign({}, payload.config),
  };
}

function payloadForIndividual(template, individual) {
  var placement = individual.placement.map(clonePolygon);
  var rotation = individual.rotation.slice();
  var ids = placement.map(function (p) {
    return p.id;
  });
  var sources = placement.map(function (p) {
    return p.source;
  });
  var children = placement.map(function (p) {
    return p.children;
  });
  var filenames = placement.map(function (p) {
    return p.filename;
  });
  return {
    index: 0,
    sheets: JSON.parse(JSON.stringify(template.sheets)),
    sheetids: template.sheetids.slice(),
    sheetsources: template.sheetsources.slice(),
    sheetchildren: JSON.parse(JSON.stringify(template.sheetchildren)),
    individual: { placement: placement, rotation: rotation },
    config: Object.assign({}, template.config),
    ids: ids,
    sources: sources,
    children: children,
    filenames: filenames,
  };
}

function clonePlacementResult(r) {
  try {
    return JSON.parse(JSON.stringify(r));
  } catch (e) {
    return r;
  }
}

function parseTopK() {
  var k = parseInt(process.env.NESTNOW_TOP_K || "3", 10);
  if (!Number.isFinite(k) || k < 1) k = 3;
  return Math.min(20, k);
}

/**
 * Merge global best, per-round snapshots, and top-K eval hits for HTTP `candidates`.
 * Sorted by fitness ascending, deduped by fitness epsilon, capped by NESTNOW_TOP_K.
 */
function mergeCandidateRawsForResponse(globalBest, topKRaw, roundRaw) {
  var cap = parseTopK();
  var all = [];
  function add(r) {
    if (r && typeof r.fitness === "number" && Number.isFinite(r.fitness)) {
      all.push(r);
    }
  }
  add(globalBest);
  if (roundRaw) {
    for (var i = 0; i < roundRaw.length; i++) {
      add(roundRaw[i]);
    }
  }
  if (topKRaw) {
    for (var j = 0; j < topKRaw.length; j++) {
      add(topKRaw[j]);
    }
  }
  all.sort(function (a, b) {
    return a.fitness - b.fitness;
  });
  var EPS = 1e-6;
  var out = [];
  var last = null;
  for (var n = 0; n < all.length; n++) {
    var f = all[n].fitness;
    if (last !== null && Math.abs(f - last) < EPS) {
      continue;
    }
    last = f;
    out.push(all[n]);
    if (out.length >= cap) {
      break;
    }
  }
  return out;
}

/**
 * Max layout evaluations per HTTP /nest job.
 * - If NESTNOW_GA_MAX_EVALS is set: use it (clamped), full override.
 * - Else: allow up to populationSize × gaGenerations, capped at 10M, floor 500 (legacy small jobs).
 */
function resolveGaMaxEvals(pop, generations) {
  var requested = pop * generations;
  if (!Number.isFinite(requested) || requested < 1) requested = 1;
  if (requested > Number.MAX_SAFE_INTEGER) {
    requested = Number.MAX_SAFE_INTEGER;
  }

  var envRaw = process.env.NESTNOW_GA_MAX_EVALS;
  if (envRaw != null && String(envRaw).trim() !== "") {
    var fromEnv = parseInt(String(envRaw), 10);
    if (!Number.isFinite(fromEnv) || fromEnv < 1) fromEnv = 500;
    var HARD_MAX = 50000000;
    return Math.min(fromEnv, HARD_MAX);
  }

  var DEFAULT_CEILING = 10000000;
  var FLOOR = 500;
  var capped = Math.min(requested, DEFAULT_CEILING);
  return Math.max(FLOOR, capped);
}

class GeneticAlgorithm {
  /**
   * @param {Array} adam - Part polygons (order preserved when seeding Phase 2).
   * @param {object} config
   * @param {number[]|null|undefined} seedRotations - If length matches adam, used for population[0]; else random.
   */
  constructor(adam, config, seedRotations) {
    this.config = Object.assign(
      { populationSize: 10, mutationRate: 10, rotations: 4 },
      config || {}
    );
    if (!(this.config.rotations > 0)) this.config.rotations = 4;

    var angles;
    var rotCount = this.config.rotations;
    var step = 360 / rotCount;
    if (
      seedRotations &&
      seedRotations.length === adam.length
    ) {
      angles = seedRotations.map(function (r) {
        var n = Number(r);
        if (!Number.isFinite(n)) n = 0;
        n = ((n % 360) + 360) % 360;
        var q = Math.round(n / step) % rotCount;
        return q * step;
      });
    } else {
      angles = [];
      for (var i = 0; i < adam.length; i++) {
        angles.push(
          Math.floor(Math.random() * rotCount) * step
        );
      }
    }

    this.population = [{ placement: adam, rotation: angles }];

    while (this.population.length < this.config.populationSize) {
      var mutant = this.mutate(this.population[0]);
      this.population.push(mutant);
    }
  }

  mutate(individual) {
    var clone = {
      placement: individual.placement.slice(0),
      rotation: individual.rotation.slice(0),
    };
    for (var i = 0; i < clone.placement.length; i++) {
      var rand = Math.random();
      if (rand < 0.01 * this.config.mutationRate) {
        var j = i + 1;
        if (j < clone.placement.length) {
          var temp = clone.placement[i];
          clone.placement[i] = clone.placement[j];
          clone.placement[j] = temp;
        }
      }

      rand = Math.random();
      if (rand < 0.01 * this.config.mutationRate) {
        clone.rotation[i] =
          Math.floor(Math.random() * this.config.rotations) *
          (360 / this.config.rotations);
      }
    }

    return clone;
  }

  mate(male, female) {
    var cutpoint = Math.round(
      Math.min(Math.max(Math.random(), 0.1), 0.9) * (male.placement.length - 1)
    );

    var gene1 = male.placement.slice(0, cutpoint);
    var rot1 = male.rotation.slice(0, cutpoint);

    var gene2 = female.placement.slice(0, cutpoint);
    var rot2 = female.rotation.slice(0, cutpoint);

    function contains(gene, id) {
      for (var i = 0; i < gene.length; i++) {
        if (gene[i].id == id) {
          return true;
        }
      }
      return false;
    }

    for (var i = 0; i < female.placement.length; i++) {
      if (!contains(gene1, female.placement[i].id)) {
        gene1.push(female.placement[i]);
        rot1.push(female.rotation[i]);
      }
    }

    for (var j = 0; j < male.placement.length; j++) {
      if (!contains(gene2, male.placement[j].id)) {
        gene2.push(male.placement[j]);
        rot2.push(male.rotation[j]);
      }
    }

    return [
      { placement: gene1, rotation: rot1 },
      { placement: gene2, rotation: rot2 },
    ];
  }

  generation() {
    this.population.sort(function (a, b) {
      var af = a.fitness != null ? a.fitness : Infinity;
      var bf = b.fitness != null ? b.fitness : Infinity;
      return af - bf;
    });

    var newpopulation = [this.population[0]];

    while (newpopulation.length < this.population.length) {
      var male = this.randomWeightedIndividual();
      var female = this.randomWeightedIndividual(male);

      var children = this.mate(male, female);

      newpopulation.push(this.mutate(children[0]));

      if (newpopulation.length < this.population.length) {
        newpopulation.push(this.mutate(children[1]));
      }
    }

    this.population = newpopulation;
  }

  randomWeightedIndividual(exclude) {
    var pop = this.population.slice(0);

    if (exclude && pop.indexOf(exclude) >= 0) {
      pop.splice(pop.indexOf(exclude), 1);
    }

    if (pop.length === 0) {
      return this.population[0];
    }

    var rand = Math.random();

    var lower = 0;
    var weight = 1 / pop.length;
    var upper = weight;

    for (var i = 0; i < pop.length; i++) {
      if (rand > lower && rand < upper) {
        return pop[i];
      }
      lower = upper;
      upper += 2 * weight * ((pop.length - i) / pop.length);
    }

    return pop[0];
  }
}

/**
 * @param {object} templatePayload - Result shape from apiToBackgroundPayload().payload
 * @param {{ runSingle: (p: object) => Promise<object>, onProgress?: (s: object) => void }} options
 */
async function runServerGeneticNesting(templatePayload, options) {
  var runSingle = options.runSingle;
  var onProgress = options.onProgress || function () {};

  var config = templatePayload.config || {};
  var pop = Math.max(1, parseInt(String(config.populationSize || 10), 10) || 10);
  var generations = Math.max(
    1,
    parseInt(String(config.gaGenerations != null ? config.gaGenerations : 3), 10) || 3
  );
  var maxEval = resolveGaMaxEvals(pop, generations);
  var useGA = pop >= 2 && process.env.NESTNOW_DISABLE_GA !== "1";

  var topK = parseTopK();
  var topList = [];
  /** Last non-empty worker error from a failed evaluation (for HTTP 500 detail). */
  var lastEvalError = "";

  function recordEvalError(result) {
    if (result && result.error != null) {
      var em = String(result.error).trim();
      if (em) lastEvalError = em;
    }
  }

  function considerTopK(placementResult) {
    if (!placementResult || placementResult.fitness == null) return;
    topList.push({
      fitness: placementResult.fitness,
      raw: clonePlacementResult(placementResult),
    });
    topList.sort(function (a, b) {
      return a.fitness - b.fitness;
    });
    if (topList.length > topK) {
      topList = topList.slice(0, topK);
    }
  }

  if (!useGA) {
    var single = await runSingle(templatePayload);
    recordEvalError(single);
    var singleCand = [];
    var singleRoundBests = [];
    if (single && single.fitness != null) {
      attachChromosomeToResult(single, templatePayload.individual);
      considerTopK(single);
      singleCand = topList.map(function (e) {
        return e.raw;
      });
      singleRoundBests.push(clonePlacementResult(single));
      onProgress({
        gen: 0,
        generations: 1,
        idx: 0,
        pop: 1,
        evalCount: 1,
        bestSoFar: placementToApiResponse(single),
      });
    }
    return {
      result: single,
      evalCount: 1,
      candidates: singleCand,
      roundBests: singleRoundBests,
      lastEvalError: lastEvalError || undefined,
      populationSize: 1,
      gaGenerations: 1,
    };
  }

  var template = nestTemplateFromPayload(templatePayload);
  var adam;
  var seedRots = null;
  if (templatePayload.seedChromosome) {
    adam = templatePayload.individual.placement.map(clonePolygon);
    seedRots = templatePayload.individual.rotation.slice();
  } else {
    adam = sortAdamByAreaDesc(
      templatePayload.individual.placement.map(clonePolygon)
    );
  }
  var ga = new GeneticAlgorithm(adam, config, seedRots);

  var bestResult = null;
  var bestFitness = Infinity;
  var evalCount = 0;
  var roundBests = [];

  async function evaluateIndividual(individual, gen, idx) {
    if (evalCount >= maxEval) return;
    var payload = payloadForIndividual(template, individual);
    var result = await runSingle(payload);
    evalCount++;
    var prevBest = bestFitness;
    if (result && result.fitness != null) {
      individual.fitness = result.fitness;
      attachChromosomeToResult(result, individual);
      considerTopK(result);
      if (result.fitness < prevBest) {
        bestFitness = result.fitness;
        bestResult = result;
      }
    } else {
      individual.fitness = Infinity;
      recordEvalError(result);
    }
    onProgress({
      gen: gen,
      generations: generations,
      idx: idx,
      pop: ga.population.length,
      evalCount: evalCount,
    });
  }

  for (var gen = 0; gen < generations; gen++) {
    if (evalCount >= maxEval) break;
    for (var i = 0; i < ga.population.length; i++) {
      if (evalCount >= maxEval) break;
      await evaluateIndividual(ga.population[i], gen, i);
    }
    if (bestResult) {
      roundBests.push(clonePlacementResult(bestResult));
      onProgress({
        gen: gen,
        generations: generations,
        idx: Math.max(0, ga.population.length - 1),
        pop: ga.population.length,
        evalCount: evalCount,
        bestSoFar: placementToApiResponse(bestResult),
      });
    }
    if (evalCount >= maxEval) break;
    if (gen < generations - 1) {
      ga.generation();
    }
  }

  var candidatesRaw = topList.map(function (e) {
    return e.raw;
  });
  return {
    result: bestResult,
    evalCount: evalCount,
    candidates: candidatesRaw,
    roundBests: roundBests,
    lastEvalError: lastEvalError || undefined,
    populationSize: pop,
    gaGenerations: generations,
  };
}

module.exports = {
  runServerGeneticNesting,
  GeneticAlgorithm,
  nestTemplateFromPayload,
  payloadForIndividual,
  clonePolygon,
  serializeChromosomeFromIndividual,
  mergeCandidateRawsForResponse,
  parseTopK,
};
