/**
 * Genetic nesting search for HTTP server mode (main process).
 * Mirrors main/deepnest.js GeneticAlgorithm without renderer IPC.
 */

"use strict";

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

class GeneticAlgorithm {
  constructor(adam, config) {
    this.config = Object.assign(
      { populationSize: 10, mutationRate: 10, rotations: 4 },
      config || {}
    );
    if (!(this.config.rotations > 0)) this.config.rotations = 4;

    var angles = [];
    for (var i = 0; i < adam.length; i++) {
      var angle =
        Math.floor(Math.random() * this.config.rotations) *
        (360 / this.config.rotations);
      angles.push(angle);
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
  var maxEval = parseInt(process.env.NESTNOW_GA_MAX_EVALS || "500", 10);
  if (!Number.isFinite(maxEval) || maxEval < 1) maxEval = 500;
  var useGA = pop >= 2 && process.env.NESTNOW_DISABLE_GA !== "1";

  if (!useGA) {
    var single = await runSingle(templatePayload);
    return { result: single, evalCount: 1 };
  }

  var template = nestTemplateFromPayload(templatePayload);
  var adam = sortAdamByAreaDesc(
    templatePayload.individual.placement.map(clonePolygon)
  );
  var ga = new GeneticAlgorithm(adam, config);

  var bestResult = null;
  var bestFitness = Infinity;
  var evalCount = 0;

  async function evaluateIndividual(individual, gen, idx) {
    if (evalCount >= maxEval) return;
    var payload = payloadForIndividual(template, individual);
    var result = await runSingle(payload);
    evalCount++;
    if (result && result.fitness != null) {
      individual.fitness = result.fitness;
      if (result.fitness < bestFitness) {
        bestFitness = result.fitness;
        bestResult = result;
      }
    } else {
      individual.fitness = Infinity;
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
    if (evalCount >= maxEval) break;
    if (gen < generations - 1) {
      ga.generation();
    }
  }

  return { result: bestResult, evalCount: evalCount };
}

module.exports = {
  runServerGeneticNesting,
  GeneticAlgorithm,
  nestTemplateFromPayload,
  payloadForIndividual,
  clonePolygon,
};
