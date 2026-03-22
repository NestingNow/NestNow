## NestNow

**Make 2D nesting easy** – NestNow is a modern fork of deepnest-next, focused on:

- Fast 2D nesting for CNC, laser, and plotter workflows
- Headless server mode for integration with external apps (for example, Keystone PMS)
- Developer-friendly APIs and docs for programmatic use

> NestNow powers the nesting engine for the Keystone PMS project management system.

### Features

- Deep nesting engine in the SVGNest / deepnest family
- Electron desktop app with interactive UI
- HTTP server mode for headless, local integration
- Support for SVG parts, rectangular sheets, and common nesting parameters (spacing, rotations, placement strategies)
- Native performance via compiled modules (see `BUILD.md` prerequisites)

---

## Quick start

### Desktop app

1. Clone and install:

   ```sh
   git clone https://github.com/NestingNow/NestNow.git
   cd NestNow
   npm install
   npm run build
   ```

2. Run the app:

   ```sh
   npm run start
   ```

### Server mode (for integrations like Keystone PMS)

See [`SERVER.md`](SERVER.md) for full details. For **timing comparisons** between server mode and the desktop app, see [`BENCHMARK.md`](BENCHMARK.md).

Short version:

```sh
npm install
npm run build
npm run start:server
```

The server will log:

```text
NestNow server mode: POST http://127.0.0.1:3001/nest
```

Default endpoint:

- `POST http://127.0.0.1:3001/nest`

Request/response schema and error codes are documented in `SERVER.md`.

---

## Using NestNow from Keystone PMS

In the Keystone PMS repo:

- Configure in `.env.local`:

  ```env
  NESTNOW_URL=http://127.0.0.1:3001
  ```

- Start NestNow in server mode in this repo:

  ```sh
  npm run start:server
  ```

With both apps running, the Nest Tool in Keystone PMS can send jobs to NestNow and display nesting results.

---

## Build and development

See [`BUILD.md`](BUILD.md) for full platform-specific instructions.

### Prerequisites (summary)

- Node 20+
- Platform build tools (for example, Xcode and Homebrew on macOS, MSVC on Windows)
- Optional: Python and Rust for advanced or plugin scenarios

### Clean builds

```sh
# Normal clean + rebuild
npm run clean
npm run build

# Full reset (including node_modules)
npm run clean-all
npm install
npm run build
```

---

## Roadmap

High-level areas we are focusing on:

- Improved performance and stability in server mode
- Cloud nesting services
- Additional file format support (native DXF, CSV or JSON batch imports)
- Better diagnostics and observability for integrations

---

## Fork history and credits

NestNow is a maintained fork in the deepnest family:

- https://github.com/Jack000/SVGnest (academic work references)
- https://github.com/Jack000/Deepnest
  - https://github.com/Dogthemachine/Deepnest
    - https://github.com/cmidgley/Deepnest
      - https://github.com/deepnest-io/Deepnest
        - https://github.com/deepnest-next/deepnest
          - https://github.com/NestingNow/NestNow

We are grateful to all previous maintainers and contributors. See `LICENSE` and `LICENSES.md` for license details (MIT plus third-party notices).

---

## License

The main license is MIT:

- [`LICENSE`](LICENSE)

Additional licenses for dependencies:

- [`LICENSES.md`](LICENSES.md)

