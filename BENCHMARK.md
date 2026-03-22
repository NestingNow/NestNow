# Nesting performance benchmarks

## Server mode vs desktop UI

NestNow’s **HTTP server mode** (`npm run start:server`) and the **desktop Electron app** use the same placement engine, but the **NFP preparation phase** differs:

- **Desktop** (`main/background.js`, default path): NFP pairs are processed with a `Parallel` worker pool when applicable, with progress reported for that phase.
- **Server mode** (`_serverMode`): NFP pairs run **synchronously** on the main thread so the process reliably returns a single HTTP response without worker-thread edge cases.

For the same parts and config, **server mode is often slower** on multi-core machines for medium-to-large jobs. That is expected; optimizing server-mode parallelism is on the roadmap.

### Automated server timing

With NestNow server already running:

```sh
node scripts/benchmark-server-nesting.cjs
```

Optional environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `NESTNOW_BENCHMARK_PORT` | `3001` | Server port |
| `NESTNOW_BENCHMARK_PARTS` | `6` | Number of distinct rectangular parts (1–50) |

The script prints wall time for `POST /nest` and a one-line summary of the JSON result.

### Comparing with desktop

1. Build a similar part list in the NestNow UI (same sheet size and part rectangles as in `scripts/benchmark-server-nesting.cjs`, or import equivalent SVGs).
2. Use the same **spacing**, **rotations**, and disable merge lines to match the script’s `config`.
3. Time from **Start nest** until the UI shows a result, and compare to the script’s server measurement.

This is a **manual** comparison; the script only automates the server path.
