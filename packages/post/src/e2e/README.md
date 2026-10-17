# G-code regression corpus

Each project in [`projects.ts`](projects.ts) goes through the same steps as the workspace: an input file from [`fixtures/`](fixtures/) is imported (SVG or STL), aligned to the stock (ADR-0022) or placed as a new model (ADR-0031), and given operations. Then `exportGcode` posts it. [`corpus.test.ts`](corpus.test.ts) checks three things for every project:

1. **The program checked in** under [`programs/`](programs/), byte for byte. A change to any toolpath or to the post-processor shows up here as a diff in the PR.
2. **Safety**, with [`check.ts`](check.ts). The checker reads the program back and fails on rapids through material (it replays the cuts on a heightmap, so pecking and rest machining may rapid where the material is already gone), moves below the stock bottom, feeds over the machine's limits, cuts with the spindle off, unsafe pauses and tool changes, and a bad start or end. Each failure gives a line number and a rule.
3. **The warnings** the export gives, none unless the project lists them.

The `measured` tests check what the stored programs can't show at a glance: depths, tab heights, hole positions and, on the stock the program leaves (`simulateGcode`), that parts are cut free everywhere but at their tabs.

The last four projects are real workshop jobs: a strut plate exported from OpenSCAD, a PC shelf and its handle drawn in Inkscape, and fluted cabinet doors. They use the same drawings, bits, depths and tabs as the Estlcam programs that cut them, and `measured against Estlcam` checks that the tool paths come out the same size. Where Furrow can't do what Estlcam did, the project says so: polygon holes are profiled instead of drilled, and the doors' bowl bit is a ball end mill as wide.

All of it runs in `pnpm test`.

## Adding a project

Add an input to `fixtures/` if the project needs one: small, hand-written or exported from a real editor. Write a builder in `projects.ts` and add it to `corpus()`. Keep ids fixed (`ids()`) so the program is the same on every run. Then write its program:

```sh
pnpm --filter @furrow/post exec vitest run src/e2e -u
```

Read the new program before committing it. Keep programs small: a few hundred kilobytes at most, so choose small stock, coarse step-overs and few passes.

## When a program changes

A diff in `programs/` means the G-code users cut has changed. Update a program with `-u` only when the change is intended, for example a toolpath or post-processor fix. Explain the change in the PR. A change you didn't intend is a regression. The safety check runs on the new program either way, so `-u` can't hide an unsafe one.
