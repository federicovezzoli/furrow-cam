# Furrow CAM

**Open source, web-based 2.5D CAM.** Turn 2D vector designs into G-code for CNC routers, right in your browser.

> ⚠️ **Status: pre-alpha / design phase.** There is no usable software yet. We are currently defining scope and architecture. See [docs/](docs/).

## What is it?

Furrow CAM is a Computer-Aided Manufacturing tool for **2.5D machining**: operations where the tool moves in X/Y at a series of fixed Z depths. That covers most hobby and small-shop CNC router work:

- **Profiling**: cutting parts out along a contour (inside / outside / on-line, with tabs)
- **Pocketing**: clearing material inside a closed shape
- **Drilling**: plunging holes at points or circle centers
- **Engraving / V-carving**: following lines, or variable-depth carving with V-bits *(planned)*

It is **not** a full 3D CAM (no surface finishing of freeform models), and it is not a CAD tool. You design elsewhere, import here.

## Goals

- **Runs in the browser**: no install, works on any OS.
- **Your workshop, everywhere**: projects, tool library and machine profiles saved to your account.
- **Fast feedback**: all toolpath computation happens in your browser, instantly.
- **Correct, predictable toolpaths**: what you preview is what the machine cuts.
- **Hackable**: clear architecture, documented decisions, pluggable post-processors.

## Documentation

| Folder | Contents |
| --- | --- |
| [docs/prd/](docs/prd/) | Product Requirements Documents: *what* we build and *why* |
| [docs/adr/](docs/adr/) | Architecture Decision Records: *how* we build it and the reasoning behind each choice |

## Contributing

The project is just getting started. The most useful contributions right now are feedback on the [PRDs](docs/prd/) and [ADRs](docs/adr/). Open an issue or a PR against the relevant document.

## License

[MIT](LICENSE) © 2026 Federico Vezzoli
