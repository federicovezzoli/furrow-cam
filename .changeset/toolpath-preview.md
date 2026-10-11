---
"@furrow/web": minor
"@furrow/cam-core": minor
---

Preview toolpaths in the viewport (PRD-0001 R9): cutting moves are drawn solid in their tool's colour and rapids dashed in grey (dashes keep the same size on screen at any zoom), each operation in a few line-segment draw calls whose typed arrays are built in the toolpath worker and transferred without copying (ADR-0008), along with the warnings (the moves stay in the worker), so pockets with 100k+ segments stay smooth. While an operation recomputes, its last toolpath stays on screen, dimmed. In the top view, a circle the size of the hole marks each drilled hole, which would otherwise be invisible from above. An eye button in the Operations pane hides or shows each operation's toolpath. `@furrow/cam-core` gains `toolpathLines`, which turns a toolpath into feed and rapid segment positions, the distances that dash the rapids and, when asked for a hole radius, circles at the bottom of its straight plunges (pecks merged), and `toolpathLinesBuffers` for transferring them.
