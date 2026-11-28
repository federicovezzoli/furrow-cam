---
"@furrow/post": patch
---

Export now keeps checking custom blocks for moves into the stock past `G10 L20` zeroing, probing, `G53` and controller commands like `$HZ`. It skips only the moves that need an axis the controller has lost, and checks again once a move sets it.
