---
"@furrow/post": minor
"@furrow/document": minor
"@furrow/web": minor
---

GRBL post-processor and G-code export (#26). `@furrow/post` defines the `PostProcessor` interface and a registry (`POST_PROCESSORS`) for further dialects, and `exportGcode` turns a project's enabled operations into a GRBL program: millimetres and absolute coordinates measured from the work origin (every stock anchor, custom zeros and both Z zeros), feeds limited per axis to the machine's maximums and spindle speeds kept in its range (both with warnings), `M3` without `S` for manual spindles, a pause for tool changes between different bits, and the machine's custom program start, program end, operation start and tool change blocks copied verbatim in place of the defaults. The workspace's G-code button downloads the program as a `.gcode` file, computed in a Web Worker. `projectFileName` takes an optional extension.
