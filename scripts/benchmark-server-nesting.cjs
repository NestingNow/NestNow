#!/usr/bin/env node
/**
 * Measures wall time for POST /nest against a running NestNow server.
 * Use the same payload in desktop mode (import / nest) to compare subjectively;
 * server mode uses synchronous NFP pair processing (see main/background.js _serverMode).
 *
 * Usage:
 *   npm run start:server   # in another terminal
 *   node scripts/benchmark-server-nesting.cjs
 *   NESTNOW_BENCHMARK_PORT=3001 NESTNOW_BENCHMARK_PARTS=8 node scripts/benchmark-server-nesting.cjs
 */

const http = require("http");

const PORT = parseInt(process.env.NESTNOW_BENCHMARK_PORT || "3001", 10) || 3001;
const PART_COUNT = Math.max(
  1,
  Math.min(50, parseInt(process.env.NESTNOW_BENCHMARK_PARTS || "6", 10) || 6),
);

function rectOutline(w, h) {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

function buildPayload(n) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const w = 40 + (i % 5) * 8;
    const h = 25 + (i % 3) * 6;
    parts.push({
      outline: rectOutline(w, h),
      filename: `bench-${i}`,
      quantity: 1,
    });
  }
  return {
    sheets: [{ width: 1200, height: 2400 }],
    parts,
    config: {
      spacing: 2,
      rotations: 4,
      populationSize: 4,
      gaGenerations: 1,
      mergeLines: false,
    },
    requestTimeoutMs: 600000,
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

async function main() {
  const payload = buildPayload(PART_COUNT);
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  console.log(
    `NestNow benchmark → http://127.0.0.1:${PORT}/nest  parts=${PART_COUNT}  payload≈${(payloadBytes / 1024).toFixed(1)} KiB`,
  );
  const t0 = Date.now();
  let out;
  try {
    out = await postNest(payload);
  } catch (e) {
    console.error("Request failed (is NestNow running? npm run start:server):", e.message);
    process.exit(1);
  }
  const ms = Date.now() - t0;
  console.log(`HTTP ${out.status}  wall time ${ms} ms`);
  if (out.status !== 200) {
    console.log(out.body.slice(0, 500));
    process.exit(1);
  }
  try {
    const j = JSON.parse(out.body);
    console.log(
      `  fitness=${j.fitness}  utilisation=${j.utilisation}  candidates=${Array.isArray(j.candidates) ? j.candidates.length : 0}`,
    );
  } catch {
    /* ignore */
  }
}

main();
