import * as vscode from "vscode";
import * as path from "path";
import {
  InlangConfig,
  LocaleMap,
  readInlangConfig,
  readAllLocales,
  getAllKeys,
  addKey,
  saveKeyEdits,
} from "./inlang";
import { generateUniqueKey } from "./keygen";

const M_FUNC_RE = /\bm\.([a-z][a-z0-9_]*)\(\)/g;

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _config?: InlangConfig;
  private _localeMap?: LocaleMap;
  private _pendingEdits = new Map<string, Record<string, string>>();

  constructor(private readonly _context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._getHtml();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      try {
        await this._handleMessage(msg);
      } catch (err) {
        this._postError(String(err));
      }
    });

    this._context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        if (this._config && this._localeMap) {
          this._postState();
        }
      })
    );

    // Auto-discover settings on first open
    this._tryAutoDiscover();
  }

  private async _tryAutoDiscover(): Promise<void> {
    const stored = this._context.workspaceState.get<string>("inlangSettingsPath");
    if (stored) {
      await this._loadConfig(stored);
      return;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;
    const candidate = path.join(folders[0].uri.fsPath, "project.inlang", "settings.json");
    try {
      await readInlangConfig(candidate);
      await this._loadConfig(candidate);
    } catch {
      // no auto-discovery — user sets path manually
    }
  }

  private async _loadConfig(settingsPath: string): Promise<void> {
    this._config = await readInlangConfig(settingsPath);
    this._localeMap = await readAllLocales(this._config);
    this._pendingEdits.clear();
    await this._context.workspaceState.update("inlangSettingsPath", settingsPath);
    this._postState();
  }

  private async _handleMessage(msg: { type: string; [k: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case "ready":
        this._postState();
        break;

      case "setConfigPath":
        await this._loadConfig(msg.path as string);
        break;

      case "newKey":
        await this.handleNewKeyCommand();
        break;

      case "editKey": {
        const { key, locale, value } = msg as { type: string; key: string; locale: string; value: string };
        const edits = this._pendingEdits.get(key) ?? {};
        edits[locale] = value;
        this._pendingEdits.set(key, edits);
        break;
      }

      case "saveKey": {
        const key = msg.key as string;
        if (!this._config || !this._localeMap) break;
        const edits = this._pendingEdits.get(key);
        if (!edits) break;
        await saveKeyEdits(this._config, this._localeMap, key, edits);
        this._pendingEdits.delete(key);
        break;
      }

      case "searchKeys": {
        const query = (msg.query as string).toLowerCase().trim();
        if (!this._config || !this._localeMap) break;
        const base = this._config.baseLocale;
        const results = getAllKeys(this._localeMap, base)
          .filter((k) => k.includes(query) || (this._localeMap![base][k] ?? "").toLowerCase().includes(query))
          .map((k) => ({ key: k, value: this._localeMap![base][k] ?? "" }))
          .slice(0, 50);
        this._view?.webview.postMessage({ type: "searchResults", results });
        break;
      }
    }
  }

  async handleNewKeyCommand(): Promise<void> {
    if (!this._config || !this._localeMap) {
      vscode.window.showErrorMessage("Paraglide Helper: No settings loaded. Set the config path first.");
      return;
    }
    const existing = new Set(getAllKeys(this._localeMap, this._config.baseLocale));
    const suggested = generateUniqueKey(existing);
    const key = await vscode.window.showInputBox({
      value: suggested,
      prompt: "Confirm or edit the translation key name",
      validateInput: (v) => {
        if (!v) return "Key cannot be empty";
        if (!/^[a-z][a-z0-9_]*$/.test(v)) return "Use lowercase letters, digits, underscores only";
        if (existing.has(v)) return "Key already exists";
        return null;
      },
    });
    if (!key) return;

    await addKey(this._config, this._localeMap, key, "");

    const editor = vscode.window.activeTextEditor;
    if (editor) {
      await editor.edit((edit) => {
        edit.insert(editor.selection.active, `m.${key}()`);
      });
    }

    this._postState();
  }

  private _postState(): void {
    if (!this._view) return;
    const keys = this._config && this._localeMap
      ? getAllKeys(this._localeMap, this._config.baseLocale)
      : [];
    const currentFileKeys = this._getCurrentFileKeys();
    const baseValues: Record<string, string> = {};
    if (this._config && this._localeMap) {
      const base = this._config.baseLocale;
      for (const k of keys) {
        baseValues[k] = this._localeMap[base][k] ?? "";
      }
    }
    this._view.webview.postMessage({
      type: "state",
      configPath: this._context.workspaceState.get<string>("inlangSettingsPath") ?? "",
      locales: this._config?.locales ?? [],
      baseLocale: this._config?.baseLocale ?? "",
      keys,
      baseValues,
      currentFileKeys,
      localeMap: this._localeMap ?? {},
    });
  }

  private _getCurrentFileKeys(): string[] {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return [];
    const text = editor.document.getText();
    const found = new Set<string>();
    let m: RegExpExecArray | null;
    M_FUNC_RE.lastIndex = 0;
    while ((m = M_FUNC_RE.exec(text)) !== null) {
      found.add(m[1]);
    }
    return [...found];
  }

  private _postError(message: string): void {
    this._view?.webview.postMessage({ type: "error", message });
  }

  private _getHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    padding: 8px;
  }
  section { margin-bottom: 16px; }
  h4 { margin-bottom: 6px; font-size: 11px; text-transform: uppercase; opacity: 0.7; }
  input[type="text"] {
    width: 100%;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 4px 6px;
    outline: none;
    font-size: inherit;
    font-family: inherit;
  }
  input[type="text"]:focus { border-color: var(--vscode-focusBorder); }
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 4px 10px;
    cursor: pointer;
    font-size: inherit;
    font-family: inherit;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .row { display: flex; gap: 4px; align-items: center; }
  .row input { flex: 1; }
  .key-item { margin-bottom: 8px; border-bottom: 1px solid var(--vscode-panel-border, #333); padding-bottom: 8px; }
  .key-name { font-weight: bold; font-size: 12px; margin-bottom: 4px; }
  .locale-row { display: flex; gap: 4px; align-items: center; margin-bottom: 4px; }
  .locale-label { width: 28px; flex-shrink: 0; font-size: 10px; opacity: 0.7; }
  .locale-row input { flex: 1; }
  .error { color: var(--vscode-errorForeground); font-size: 11px; margin-top: 4px; }
  .empty { opacity: 0.5; font-size: 11px; }
  .search-result { padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border, #333); }
  .result-key { font-weight: bold; font-size: 11px; }
  .result-val { font-size: 11px; opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
</head>
<body>
<section id="s-config">
  <h4>Config</h4>
  <div class="row">
    <input id="configPath" type="text" placeholder="project.inlang/settings.json path" />
    <button id="loadConfig">Load</button>
  </div>
  <div id="configError" class="error"></div>
</section>

<section id="s-search">
  <h4>Search</h4>
  <input id="searchInput" type="text" placeholder="Search keys..." />
  <div id="searchResults"></div>
</section>

<section id="s-newkey">
  <h4>New Key</h4>
  <button id="newKeyBtn">+ New Key</button>
</section>

<section id="s-current">
  <h4>Keys in current file</h4>
  <div id="currentKeysList"></div>
</section>

<script>
  const vscode = acquireVsCodeApi();
  let state = { configPath: '', locales: [], baseLocale: '', keys: [], baseValues: {}, currentFileKeys: [], localeMap: {} };
  let searchTimer = null;

  document.getElementById('loadConfig').addEventListener('click', () => {
    const p = document.getElementById('configPath').value.trim();
    if (!p) return;
    vscode.postMessage({ type: 'setConfigPath', path: p });
  });

  document.getElementById('configPath').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('loadConfig').click();
  });

  document.getElementById('newKeyBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'newKey' });
  });

  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value;
    if (!q.trim()) { document.getElementById('searchResults').innerHTML = ''; return; }
    searchTimer = setTimeout(() => {
      vscode.postMessage({ type: 'searchKeys', query: q });
    }, 200);
  });

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'state') {
      state = msg;
      document.getElementById('configPath').value = msg.configPath || '';
      document.getElementById('configError').textContent = '';
      renderCurrentKeys();
    } else if (msg.type === 'searchResults') {
      renderSearchResults(msg.results);
    } else if (msg.type === 'error') {
      document.getElementById('configError').textContent = msg.message;
    }
  });

  function renderCurrentKeys() {
    const container = document.getElementById('currentKeysList');
    const { currentFileKeys, locales, baseLocale, localeMap } = state;
    if (!currentFileKeys.length) {
      container.innerHTML = '<div class="empty">No m.key() calls found in current file</div>';
      return;
    }
    container.innerHTML = currentFileKeys.map(key => {
      const localeInputs = locales.map(locale => {
        const val = (localeMap[locale] || {})[key] || '';
        return \`<div class="locale-row">
          <span class="locale-label">\${escHtml(locale)}</span>
          <input type="text" data-key="\${escHtml(key)}" data-locale="\${escHtml(locale)}"
                 value="\${escHtml(val)}" placeholder="(empty)" />
        </div>\`;
      }).join('');
      return \`<div class="key-item">
        <div class="key-name">\${escHtml(key)}</div>
        \${localeInputs}
        <button class="secondary save-btn" data-key="\${escHtml(key)}">Save</button>
      </div>\`;
    }).join('');

    container.querySelectorAll('input[data-key]').forEach(input => {
      input.addEventListener('input', (e) => {
        const el = e.target;
        vscode.postMessage({ type: 'editKey', key: el.dataset.key, locale: el.dataset.locale, value: el.value });
      });
    });

    container.querySelectorAll('.save-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'saveKey', key: btn.dataset.key });
      });
    });
  }

  function renderSearchResults(results) {
    const container = document.getElementById('searchResults');
    if (!results.length) {
      container.innerHTML = '<div class="empty">No results</div>';
      return;
    }
    container.innerHTML = results.map(r =>
      \`<div class="search-result">
        <div class="result-key">\${escHtml(r.key)}</div>
        <div class="result-val">\${escHtml(r.value || '(empty)')}</div>
      </div>\`
    ).join('');
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
