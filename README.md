# Poirot

A VS Code / Cursor extension for managing [paraglide-js](https://inlang.com/m/gerre34r/library-inlang-paraglideJs) translation keys without leaving your editor.

## Features

- **Inline decorations** — every `m.key()` call in your code shows the base locale translation value next to it in a subtle bordered box
- **CodeLens links** — a clickable `↗ open in en.json` link appears above each line, jumping straight to that key in the locale file
- **Sidebar panel** — browse all keys, see the top 3 locale values, search by key name or value, edit and save translations in place
- **New key flow** — `Cmd+Shift+T` (Mac) / `Ctrl+Shift+T`: type the translation value, confirm the auto-generated key name, and `m.key()` is inserted at the cursor
- **MCP server** — exposes a `create_translation_key` tool so AI agents (Cursor, Claude Code) can create keys directly
- **Always on** — decorations and the MCP server start automatically on workspace open, no sidebar interaction required

## Requirements

- A paraglide-js project with an `project.inlang/settings.json` file
- Locale files in the path pattern defined by `plugin.inlang.messageFormat.pathPattern`

## Installation

### From source

```bash
git clone https://github.com/haenning/poirot
cd poirot
./install.sh
```

The script builds the extension and installs it into Cursor or VS Code automatically.

### Manual

```bash
npm install
npm run package
code --install-extension poirot-0.0.1.vsix
```

## Usage

Poirot auto-discovers `project.inlang/settings.json` at the workspace root on startup. If your settings file is elsewhere, open the Poirot sidebar and enter the path manually.

### Keyboard shortcut

| Action              | Mac            | Windows / Linux  |
| ------------------- | -------------- | ---------------- |
| New translation key | `Cmd+Shift+T`  | `Ctrl+Shift+T`   |

### Sidebar

Open the Poirot panel from the activity bar (speech bubble icon).

- **No search query** — shows keys used in the current file
- **With search query** — searches all keys by name and value across all locale files
- **Edit button** — makes locale values editable inline; Save writes atomically to disk
- **+ New Key** — same as the keyboard shortcut

### MCP (Cursor / Claude Code)

On activation Poirot writes a `poirot` entry to `~/.cursor/mcp.json` automatically. Four tools are exposed to any MCP-compatible agent:

| Tool | When to use |
| ---- | ----------- |
| `create_translation_key` | Create a single key |
| `create_translation_keys` | Create multiple keys in one call — always prefer this over calling the single-key tool in a loop |
| `auto_translate` | Translate all missing locale values by running `npm run machine-translate` in the project root — call only once, at the very end of an editing session |
| `check_paraglide` | Compile paraglide and report missing/orphan keys — use after larger batches of changes |

```text
create_translation_keys(entries: [
  { value: "Submit form" },
  { value: "Cancel" }
])
→ m.brave_quiet_fox()  ← "Submit form"
→ m.calm_silver_hawk()  ← "Cancel"
```

The agent receives the generated key references and inserts them directly into code. After all keys are created, it can call `auto_translate` to fill in secondary locales via the paraglide machine-translate script.

## Project structure expected

```text
your-project/
└── project.inlang/
    └── settings.json       ← pathPattern lives here
```

`settings.json` example:

```json
{
  "baseLocale": "en",
  "locales": ["en", "de", "fr"],
  "plugin.inlang.messageFormat": {
    "pathPattern": "./messages/{locale}.json"
  }
}
```

## Development

```bash
npm install
npm run watch        # rebuild on change
```

Press `F5` in VS Code to launch an Extension Development Host, or:

```bash
code --extensionDevelopmentPath=/path/to/poirot /path/to/test-project
```

After a code change, run `Developer: Reload Window` in the dev host — no restart needed.
