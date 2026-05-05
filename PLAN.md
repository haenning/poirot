# paraglide-helper — Build Plan

## Status: Built ✓ — ready for manual smoke test

---

## What we're building
A VS Code extension (TypeScript) that manages paraglide-js/inlang i18n translation keys from an Activity Bar sidebar. No inlang SDK — reads/writes locale JSON files directly.

---

## File layout (target)

```
├── package.json           VS Code extension manifest + scripts
├── tsconfig.json
├── .vscodeignore
├── .gitignore
├── esbuild.js             Build script (two bundles: extension + mcp-server)
├── src/
│   ├── extension.ts       Activation, command registration
│   ├── sidebar.ts         WebviewViewProvider — all UI state + message handling
│   ├── inlang.ts          Read settings.json, resolve locale paths, read/write JSON
│   ├── keygen.ts          unique-names-generator wrapper + collision check
│   ├── atomic.ts          Atomic write helper (tmp → rename)
│   └── mcp-server.ts      MCP server entry point + extension-side spawn helpers
└── dist/                  esbuild output (gitignored)
    ├── extension.js
    └── mcp-server.js
```

---

## Implementation steps

| # | Step | Status |
|---|---|---|
| 1 | Scaffold: package.json, tsconfig.json, .gitignore, .vscodeignore | ☐ |
| 2 | esbuild.js — two-bundle build script | ☐ |
| 3 | src/atomic.ts — atomicWriteJson (tmp → rename) | ☐ |
| 4 | src/keygen.ts — generateKey + generateUniqueKey | ☐ |
| 5 | src/inlang.ts — readInlangConfig, readAllLocales, addKey, etc. | ☐ |
| 6 | src/sidebar.ts — WebviewViewProvider, inline HTML UI, message protocol | ☐ |
| 7 | src/mcp-server.ts — MCP stdio server + spawnMcpServer + writeCursorConfig | ☐ |
| 8 | src/extension.ts — activate(), register commands + sidebar + MCP | ☐ |
| 9 | npm install && npm run compile — verify both bundles build | ☐ |
| 10 | Manual smoke test in Extension Development Host | ☐ |

---

## Key design decisions

- **esbuild** (not webpack) — single 30-line build script, two bundle passes
- **Inline HTML** in sidebar.ts — no separate file, no webview resource URI complexity
- **`require.main === module` guard** in mcp-server.ts — one file handles both the standalone server and the extension-side spawn helpers
- **No inlang SDK** — settings.json is simple JSON; direct parse is more reliable
- **Atomic writes everywhere** — write to `os.tmpdir()` temp, then `fs.rename` over destination
- **No auto-save** — edits are held in `_pendingEdits` Map; only explicit Save button flushes to disk
- **Immediate write on key creation** — `addKey` writes all locale files in parallel via `Promise.all`

---

## Verification checklist (once built)

- [ ] `npm run compile` exits 0, dist/ has extension.js and mcp-server.js
- [ ] F5 in VS Code → Extension Development Host → globe icon in Activity Bar
- [ ] Config section: set path to `project.inlang/settings.json` → loads locales
- [ ] New Key: click `+` → generated key in input box → confirm → `m.key()` at cursor + locale files updated
- [ ] Edit key value → Save → JSON file written atomically
- [ ] Search input → results show key + base locale value
- [ ] MCP: `npx @modelcontextprotocol/inspector node dist/mcp-server.js` → `create_translation_key` returns `m.key()`
- [ ] `~/.cursor/mcp.json` written on first activation (not overwritten on subsequent activations)

---

## Dependencies

```json
"dependencies": {
  "unique-names-generator": "^4.7.1",
  "@modelcontextprotocol/sdk": "^1.29.0"
},
"devDependencies": {
  "typescript": "^5.4.0",
  "esbuild": "^0.28.0",
  "@types/vscode": "^1.85.0",
  "@types/node": "^20.0.0",
  "@vscode/vsce": "^3.0.0"
}
```
