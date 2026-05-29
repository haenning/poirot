# Testing Poirot

Poirot uses a three-tier test strategy so regressions are caught at the right level of the stack.

## Quick start

```bash
npm install
npm run test:all
```

## Tiers

### Unit (`npm test`)

Fast tests for pure modules — no VS Code, no child processes.

- `path-security` — path jail and workspace validation
- `inlang` — settings parsing, locale CRUD, traversal rejection
- `atomic` — atomic JSON writes
- `keygen` — key format and collision avoidance
- `rules-installer` — agent rule detection/install (no auto CLAUDE.md)
- `scan-keys` — comment-aware `m.key()` scanning
- `mcp-tools` — tool handlers and mutex serialization
- `mcp-ipc` — message size limits

Fixtures live in `test/fixtures/`.

### Integration (`npm run test:integration`)

Requires a compiled extension (`dist/mcp-server.js`).

- **IPC** — forked MCP child handles tool calls via Node IPC
- **Reload signal** — `POIROT_RELOAD` emitted after writes
- **Concurrency** — parallel writes produce valid JSON
- **MCP stdio smoke** — process accepts initialize handshake
- **Security** — path traversal fixtures rejected

### E2E (`npm run test:e2e`)

Uses `@vscode/test-electron` to launch VS Code with the extension loaded against `test/fixtures/minimal-inlang`.

- Command registration
- Workspace fixture presence
- Sample file with `m.key()` opens in editor

E2E downloads VS Code on first run; allow network access in CI.

## CI

GitHub Actions workflow `.github/workflows/test.yml` runs unit, integration, audit, and E2E jobs on push/PR.

## Manual smoke test

For interactive debugging in Extension Development Host:

```bash
make test-manual
```

Or press `F5` in VS Code with the poirot workspace open.
