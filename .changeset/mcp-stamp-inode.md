---
"@furrow/mcp": patch
---

The MCP server now notices when a project file was saved by another program within the same second, even if its size didn't change, and won't save over it.
