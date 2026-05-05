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
import { DecorationManager } from "./decorations";


const M_FUNC_RE = /\bm\.([a-z][a-z0-9_]*)\(\)/g;

const SUPPORTED_EXTENSIONS = new Set([
  ".svelte", ".ts", ".tsx", ".js", ".jsx", ".vue", ".astro",
]);

function isSupportedFile(uri: vscode.Uri | undefined): boolean {
  if (!uri) return false;
  const ext = uri.fsPath.slice(uri.fsPath.lastIndexOf("."));
  return SUPPORTED_EXTENSIONS.has(ext);
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _config?: InlangConfig;
  private _localeMap?: LocaleMap;
  private _pendingEdits = new Map<string, Record<string, string>>();
  private _lastFileKeys: string[] = []; // sticky — only updated on supported file switch
  private _decorations: DecorationManager;
  onConfigLoaded?: (settingsPath: string) => void;

  // search-reindex state: track last phrase that triggered a reindex
  private _reindexedFor: string | null = null;

  constructor(
    private readonly _context: vscode.ExtensionContext,
    decorations: DecorationManager
  ) {
    this._decorations = decorations;
  }

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
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (isSupportedFile(editor?.document.uri)) {
          this._lastFileKeys = this._scanFileKeys(editor!);
          this._postState();
        }
        // ignore unsupported files / tool windows — keep showing last known keys
      })
    );

    this._postState();
    this.tryAutoDiscover();
  }

  async tryAutoDiscover(): Promise<void> {
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
      // user sets path manually
    }
  }

  private async _loadConfig(settingsPath: string): Promise<void> {
    this._config = await readInlangConfig(settingsPath);
    this._localeMap = await readAllLocales(this._config);
    this._pendingEdits.clear();
    await this._context.workspaceState.update("inlangSettingsPath", settingsPath);
    this.onConfigLoaded?.(settingsPath);
    this._decorations.update(this._config, this._localeMap);
    this._postState();
  }

  // Called externally (e.g. from MCP reload signal) — always re-reads all files from disk
  async reloadLocales(): Promise<void> {
    if (!this._config) return;
    this._localeMap = await readAllLocales(this._config);
    this._decorations.update(this._config, this._localeMap);
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
        // re-read from disk so in-memory state matches exactly what was written
        await this.reloadLocales();
        break;
      }

      case "reindexAndSearch": {
        const query = (msg.query as string);
        if (query.length <= 3) break;
        if (this._reindexedFor === query) break; // already reindexed for this phrase
        this._reindexedFor = query;
        await this.reloadLocales(); // posts updated state — webview re-runs search
        // reset after 5s so the same phrase can reindex again later
        setTimeout(() => {
          if (this._reindexedFor === query) this._reindexedFor = null;
        }, 5000);
        break;
      }
    }
  }

  async handleNewKeyCommand(): Promise<void> {
    if (!this._config || !this._localeMap) {
      vscode.window.showErrorMessage("Poirot: No settings loaded. Set the config path first.");
      return;
    }

    const baseLocale = this._config.baseLocale;
    const value = await vscode.window.showInputBox({
      prompt: `Translation value (${baseLocale})`,
      placeHolder: "e.g. Submit form",
    });
    if (value === undefined) return;

    const existing = new Set(getAllKeys(this._localeMap, baseLocale));
    const suggested = generateUniqueKey(existing);
    const key = await vscode.window.showInputBox({
      value: suggested,
      prompt: "Key name — confirm or edit",
      validateInput: (v) => {
        if (!v) return "Key cannot be empty";
        if (!/^[a-z][a-z0-9_]*$/.test(v)) return "Use lowercase letters, digits, underscores only";
        if (existing.has(v)) return "Key already exists";
        return null;
      },
    });
    if (!key) return;

    await addKey(this._config, this._localeMap, key, value);

    const editor = vscode.window.activeTextEditor;
    if (editor) {
      await editor.edit((edit) => {
        edit.insert(editor.selection.active, `m.${key}()`);
      });
    }

    await this.reloadLocales();
  }

  private _postState(): void {
    if (!this._view) return;
    const localeMap = this._localeMap ?? {};
    const config = this._config;
    const keys = config ? getAllKeys(localeMap, config.baseLocale) : [];
    const currentFileKeys = this._getCurrentFileKeys();

    this._view.webview.postMessage({
      type: "state",
      configPath: this._context.workspaceState.get<string>("inlangSettingsPath") ?? "",
      locales: config?.locales ?? [],
      baseLocale: config?.baseLocale ?? "",
      keys,
      currentFileKeys,
      localeMap,
    });
  }

  private _scanFileKeys(editor: vscode.TextEditor): string[] {
    const text = editor.document.getText();
    const found = new Set<string>();
    let m: RegExpExecArray | null;
    M_FUNC_RE.lastIndex = 0;
    while ((m = M_FUNC_RE.exec(text)) !== null) {
      found.add(m[1]);
    }
    return [...found];
  }

  private _getCurrentFileKeys(): string[] {
    const editor = vscode.window.activeTextEditor;
    if (editor && isSupportedFile(editor.document.uri)) {
      this._lastFileKeys = this._scanFileKeys(editor);
    }
    return this._lastFileKeys;
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
  h4 { margin-bottom: 6px; font-size: 11px; text-transform: uppercase; opacity: 0.6; letter-spacing: 0.05em; }
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
    white-space: nowrap;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.icon {
    background: none;
    color: var(--vscode-foreground);
    padding: 2px 4px;
    opacity: 0.6;
    font-size: 14px;
    line-height: 1;
  }
  button.icon:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.15)); }
  .keys-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .keys-header h4 { margin-bottom: 0; }
  .row { display: flex; gap: 4px; align-items: center; }
  .row input { flex: 1; }
  .key-item {
    margin-bottom: 6px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
    padding-bottom: 6px;
  }
  .key-header { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
  .key-name { font-size: 11px; font-family: var(--vscode-editor-font-family, monospace); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .locale-row { display: flex; gap: 4px; align-items: baseline; margin-bottom: 3px; }
  .locale-label { width: 24px; flex-shrink: 0; font-size: 10px; opacity: 0.6; font-weight: bold; }
  .locale-val { flex: 1; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.9; }
  .locale-val.empty { opacity: 0.35; font-style: italic; }
  .locale-row input { flex: 1; font-size: 11px; }
  .save-row { margin-top: 4px; display: flex; justify-content: flex-end; gap: 4px; }
  .error { color: var(--vscode-errorForeground); font-size: 11px; margin-top: 4px; }
  .empty-msg { opacity: 0.5; font-size: 11px; }
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

<section id="s-keys">
  <div class="keys-header">
    <h4>Keys</h4>
    <button id="newKeyBtn" title="New Translation Key (⌘⇧T)">+ New Key</button>
  </div>
  <input id="searchInput" type="text" placeholder="Search all keys..." style="margin-bottom:8px" />
  <div id="keysList"></div>
</section>

<script>
  const vscode = acquireVsCodeApi();
  let state = { configPath: '', locales: [], baseLocale: '', keys: [], currentFileKeys: [], localeMap: {} };
  let searchQuery = '';
  let searchTimer = null;
  const editingKeys = new Set();
  // track which queries have already triggered a reindex
  const reindexedQueries = new Set();

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
    searchQuery = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => renderKeys(), 150);
  });

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'state') {
      state = msg;
      document.getElementById('configPath').value = msg.configPath || '';
      document.getElementById('configError').textContent = '';
      renderKeys();
    } else if (msg.type === 'error') {
      document.getElementById('configError').textContent = msg.message;
    }
  });

  function displayLocales(baseLocale, allLocales) {
    const others = allLocales.filter(l => l !== baseLocale).sort().slice(0, 2);
    return [baseLocale, ...others];
  }

  function getVisibleKeys() {
    const { currentFileKeys, localeMap, baseLocale } = state;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return currentFileKeys;
    const allKeys = Object.keys(localeMap[baseLocale] || {}).filter(k => k !== '$schema');
    return allKeys.filter(k =>
      k.toLowerCase().includes(q) ||
      String((localeMap[baseLocale] || {})[k] ?? '').toLowerCase().includes(q)
    );
  }

  function renderKeys() {
    const container = document.getElementById('keysList');
    const { locales, baseLocale, localeMap } = state;
    const visibleKeys = getVisibleKeys();
    const q = searchQuery.trim();

    if (!visibleKeys.length) {
      if (q) {
        container.innerHTML = '<div class="empty-msg">No keys match</div>';
        // reindex once for queries longer than 3 chars
        if (q.length > 3 && !reindexedQueries.has(q)) {
          reindexedQueries.add(q);
          vscode.postMessage({ type: 'reindexAndSearch', query: q });
          // allow reindexing again after 5s
          setTimeout(() => reindexedQueries.delete(q), 5000);
        }
      } else {
        container.innerHTML = '<div class="empty-msg">No m.key() calls in current file</div>';
      }
      return;
    }

    const shownLocales = displayLocales(baseLocale, locales);

    container.innerHTML = visibleKeys.map(key => {
      const isEditing = editingKeys.has(key);
      const localeRows = shownLocales.map(locale => {
        const val = String((localeMap[locale] || {})[key] ?? '');
        if (isEditing) {
          return \`<div class="locale-row">
            <span class="locale-label">\${escHtml(locale)}</span>
            <input type="text" data-key="\${escHtml(key)}" data-locale="\${escHtml(locale)}"
                   value="\${escHtml(val)}" placeholder="(empty)" />
          </div>\`;
        }
        const isEmpty = !val;
        return \`<div class="locale-row">
          <span class="locale-label">\${escHtml(locale)}</span>
          <span class="locale-val\${isEmpty ? ' empty' : ''}">\${isEmpty ? 'empty' : escHtml(val)}</span>
        </div>\`;
      }).join('');

      const editBtn = \`<button class="icon edit-btn" data-key="\${escHtml(key)}" title="Edit"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" style="pointer-events:none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m14.363 5.652l1.48-1.48a2 2 0 0 1 2.829 0l1.414 1.414a2 2 0 0 1 0 2.828l-1.48 1.48m-4.243-4.242l-9.616 9.615a2 2 0 0 0-.578 1.238l-.242 2.74a1 1 0 0 0 1.084 1.085l2.74-.242a2 2 0 0 0 1.24-.578l9.615-9.616m-4.243-4.242l4.243 4.242" /></svg></button>\`;
      const saveRow = isEditing ? \`<div class="save-row">
        <button class="secondary cancel-btn" data-key="\${escHtml(key)}">Cancel</button>
        <button class="save-btn" data-key="\${escHtml(key)}">Save</button>
      </div>\` : '';

      return \`<div class="key-item">
        <div class="key-header">
          <span class="key-name">\${escHtml(key)}</span>
          \${!isEditing ? editBtn : ''}
        </div>
        \${localeRows}
        \${saveRow}
      </div>\`;
    }).join('');

    container.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => { editingKeys.add(btn.dataset.key); renderKeys(); });
    });
    container.querySelectorAll('.cancel-btn').forEach(btn => {
      btn.addEventListener('click', () => { editingKeys.delete(btn.dataset.key); renderKeys(); });
    });
    container.querySelectorAll('input[data-key]').forEach(input => {
      input.addEventListener('input', (e) => {
        const el = e.target;
        vscode.postMessage({ type: 'editKey', key: el.dataset.key, locale: el.dataset.locale, value: el.value });
      });
    });
    container.querySelectorAll('.save-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        editingKeys.delete(btn.dataset.key);
        vscode.postMessage({ type: 'saveKey', key: btn.dataset.key });
      });
    });
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
