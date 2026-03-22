#!/usr/bin/env node
/**
 * Regression: mixed rectangles + circles must not throw (null placements[j].x).
 * Requires NestNow server: npm run start:server
 *
 * - Default: if nothing listens on 127.0.0.1:PORT, exit 0 (skip).
 * - NESTNOW_CIRCLES_PROBE_REQUIRE=1: exit 1 if server missing or nest fails.
 *
 * Run: node tests/nest-circles-regression.cjs
 */
"use strict";

const http = require("http");
const assert = require("assert");

const PORT = parseInt(process.env.NESTNOW_PORT || "3001", 10) || 3001;
const REQUIRE = process.env.NESTNOW_CIRCLES_PROBE_REQUIRE === "1";

function circleOutline(diameter, segments) {
  const r = diameter / 2;
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const theta = (2 * Math.PI * i) / segments;
    pts.push({ x: r + r * Math.cos(theta), y: r + r * Math.sin(theta) });
  }
  return pts;
}

function rectOutline(w, h) {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

function buildPayload() {
  return {
    sheets: [{ width: 96, height: 48 }],
    parts: [
      {
        outline: rectOutline(3, 9),
        filename: "rec1",
        quantity: 30,
        canRotate: true,
      },
      {
        outline: circleOutline(6, 48),
        filename: "round6",
        quantity: 10,
        canRotate: false,
      },
    ],
    config: {
      spacing: 0,
      rotations: 4,
      placementType: "gravity",
      mergeLines: false,
      curveTolerance: 0.005,
      simplify: false,
      clipperScale: 10000000,
      populationSize: 4,
      gaGenerations: 2,
      mutationRate: 10,
    },
    requestTimeoutMs: 180000,
  };
}

function postNest(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path: "/nest",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data, "utf8"),
        },
      },
      (res) => {
        let chunks = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          chunks += c;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode, body: chunks });
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

/** @returns {Promise<boolean>} true if something already listens (e.g. NestNow) */
function portInUse() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.on("error", (e) => {
      if (e.code === "EADDRINUSE") resolve(true);
      else reject(e);
    });
    s.listen(PORT, "127.0.0.1", () => {
      s.close(() => resolve(false));
    });
  });
}

async function main() {
  const busy = await portInUse();
  if (!busy) {
    const msg = `nest-circles-regression: skip (no listener on 127.0.0.1:${PORT})`;
    if (REQUIRE) {
      console.error(msg);
      process.exit(1);
    }
    console.log(msg);
    process.exit(0);
  }

  const out = await postNest(buildPayload());
  let j;
  try {
    j = JSON.parse(out.body);
  } catch {
    assert.fail(`non-JSON body: ${out.body.slice(0, 200)}`);
  }

  assert.strictEqual(
    out.status,
    200,
    `expected HTTP 200, got ${out.status}: ${JSON.stringify({
      failureKind: j.failureKind,
      lastEvalError: j.lastEvalError,
      error: j.error,
    })}`,
  );

  const placed = (j.placements || []).reduce(
    (a, p) => a + (p.sheetplacements?.length || 0),
    0,
  );
  assert.ok(
    placed > 0,
    `expected at least one placed part, got ${placed} (fitness=${j.fitness})`,
  );

  console.log(
    `nest-circles-regression: ok (placed=${placed} fitness=${j.fitness} util=${j.utilisation})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
