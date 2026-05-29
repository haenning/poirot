# Write path architecture

All locale file **mutations** go through a single coordinator. Reads (sidebar, decorations) bypass it intentionally.

```text
Sidebar / MCP tool call
        │
        ▼
   handleTool (mcp-tools.ts)
        │
        ▼
   withProjectWrite (write-coordinator.ts)
        ├── Layer 1: process mutex   (per settingsPath, same MCP child)
        └── Layer 2: file lock       (per projectDir, cross-process)
                │
                ▼
           inlang.ts → atomicWriteJson
```

## Modules

| Module | Role |
|--------|------|
| [`write-coordinator.ts`](../src/write-coordinator.ts) | **Single write entry point.** Combines process mutex + file lock. |
| [`project-lock.ts`](../src/project-lock.ts) | Cross-process `proper-lockfile` on `{projectDir}/.poirot/write.lock`. |
| [`mcp-tools.ts`](../src/mcp-tools.ts) | MCP tool handlers; every mutating tool wrapped in `withProjectWrite`. |
| [`inlang.ts`](../src/inlang.ts) | Path jail + locale CRUD; called only from locked sections. |

## Cross-process scenario

Two MCP server processes may run simultaneously:

1. Extension fork (sidebar IPC)
2. Cursor spawn from `~/.cursor/mcp.json` (agent stdio)

Each has its own process mutex. The **file lock** is what keeps both from corrupting locale JSON.

## Runtime artifacts

Poirot creates `{projectDir}/.poirot/write.lock` during writes. This directory is runtime-only (lock metadata, not user data). Safe to add to project `.gitignore` if desired.

## Testing

- Unit: `write-coordinator.test.ts`, `project-lock.test.ts`
- Integration: `test/integration/project-lock.test.ts` (multi-process)
- Benchmark: `npm run test:bench` compares mutex-only vs full coordinator

Test overrides (`setWriteCoordinatorTestOverrides`) exist **only** for benchmarks and tests — never used in extension activation.
