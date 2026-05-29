import * as vscode from "vscode";
import * as path from "path";
import {
  InlangConfig,
  LocaleMap,
  readInlangConfig,
  readAllLocales,
  getAllKeys,
} from "./inlang";
import { DecorationManager } from "./decorations";
import { detectAgents, installRules, needsUpdate, POIROT_VERSION } from "./rules-installer";
import { callMcpTool } from "./mcp-spawn";
import { scanKeysFromText } from "./scan-keys";
import { isPathInsideRoots } from "./path-security";


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
  private _candidates: string[] = [];
  private _decorations: DecorationManager;
  private _mcpServerPath?: string;
  onConfigLoaded?: (settingsPath: string) => void;

  // search-reindex state: track last phrase that triggered a reindex
  private _reindexedFor: string | null = null;

  constructor(
    private readonly _context: vscode.ExtensionContext,
    decorations: DecorationManager,
    mcpServerPath?: string
  ) {
    this._decorations = decorations;
    this._mcpServerPath = mcpServerPath;
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

    // Scan all workspace folders for settings.json candidates
    const candidates = await this._findCandidates();
    this._candidates = candidates;
    this._postState();

    if (stored) {
      await this._loadConfig(stored);
      return;
    }
    if (candidates.length === 1) {
      await this._loadConfig(candidates[0]);
    }
  }

  private async _findCandidates(): Promise<string[]> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return [];
    const found: string[] = [];
    for (const folder of folders) {
      const uris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, "**/project.inlang/settings.json"),
        "**/node_modules/**"
      );
      found.push(...uris.map((u) => u.fsPath));
    }
    return found;
  }

  private async _loadConfig(settingsPath: string): Promise<void> {
    const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    if (!isPathInsideRoots(settingsPath, roots)) {
      throw new Error("Settings path must be inside the current workspace");
    }
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
        if (!this._config) break;
        const edits = this._pendingEdits.get(key);
        if (!edits) break;
        const entries = Object.entries(edits)
          .filter(([, v]) => v.trim())
          .map(([locale, value]) => ({ key, locale, value }));
        if (entries.length > 0) {
          await callMcpTool("set_translation_values", { entries }, this._config.settingsPath);
        }
        this._pendingEdits.delete(key);
        await this.reloadLocales();
        break;
      }

      case "findUsages": {
        const key = msg.key as string;
        vscode.commands.executeCommand("workbench.action.findInFiles", {
          query: `m.${key}()`,
          triggerSearch: true,
          isRegex: false,
          filesToInclude: "src",
        });
        break;
      }

      case "installAgentRulesRequest": {
        const projectDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!projectDir || !this._mcpServerPath) break;
        const answer = await vscode.window.showWarningMessage(
          "Poirot will write to your agent rule files (CLAUDE.md, .cursor/rules/poirot.mdc, etc.). " +
          "While we do our best not to touch anything outside the ##poirot## markers, " +
          "please commit your current work first so you can quickly revert if needed.",
          { modal: true },
          "I've committed — go ahead",
          "Cancel"
        );
        if (answer !== "I've committed — go ahead") break;
        const result = installRules(
          this._mcpServerPath,
          this._config?.settingsPath,
          projectDir
        );
        const lines = [
          ...result.written.map((f) => `✓ ${path.basename(f)}`),
          ...result.errors.map((e) => `✗ ${e}`),
        ];
        vscode.window.showInformationMessage(`Poirot: ${lines.join("  ")}`);
        this._postState();
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

  openEditKey(key: string): void {
    // If the view isn't visible yet, reveal it first
    if (this._view) {
      this._view.show(true); // preserveFocus=true so editor doesn't lose caret
      this._view.webview.postMessage({ type: "openEditKey", key });
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

    const result = await callMcpTool("create_translation_keys", { entries: [{ value }] }, this._config.settingsPath);
    // Result text: "m.some_key()  [en] \"value\"" — extract the key name
    const resultText = result.content[0]?.text ?? "";
    const keyMatch = resultText.match(/^m\.([a-z][a-z0-9_]*)\(\)/);
    if (!keyMatch) {
      vscode.window.showErrorMessage(`Poirot: could not create key — ${resultText}`);
      return;
    }
    const createdKey = keyMatch[1];

    const editor = vscode.window.activeTextEditor;
    if (editor) {
      await editor.edit((edit) => {
        edit.insert(editor.selection.active, `m.${createdKey}()`);
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

    const projectDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let agentStatus: { installedIn: string[]; needsUpdate: boolean } = { installedIn: [], needsUpdate: false };
    if (projectDir) {
      try {
        const ctx = detectAgents(projectDir);
        agentStatus = { installedIn: ctx.installedIn, needsUpdate: needsUpdate(projectDir) };
      } catch { /* ignore */ }
    }

    this._view.webview.postMessage({
      type: "state",
      configPath: this._context.workspaceState.get<string>("inlangSettingsPath") ?? "",
      candidates: this._candidates,
      locales: config?.locales ?? [],
      baseLocale: config?.baseLocale ?? "",
      keys,
      currentFileKeys,
      localeMap,
      agentStatus,
      poirotVersion: POIROT_VERSION,
    });
  }

  private _scanFileKeys(editor: vscode.TextEditor): string[] {
    return scanKeysFromText(editor.document.getText());
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
  h4 { font-size: 9px; text-transform: uppercase; opacity: 0.5; letter-spacing: 0.07em; }
  input[type="text"] {
    width: 100%;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 0.5px solid var(--vscode-input-border, rgba(128,128,128,0.2));
    border-radius: 4px;
    padding: 4px 6px;
    outline: none;
    font-size: 10px;
    font-family: var(--vscode-editor-font-family, monospace);
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
    line-height: 1;
  }
  button.icon:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.15)); }
  button.full { width: 100%; margin-bottom: 6px; }
  button.new-key {
    background: color-mix(in srgb, var(--vscode-button-background) 40%, transparent);
    color: var(--vscode-button-foreground);
    border: 0.5px solid var(--vscode-focusBorder, rgba(60,110,220,0.5));
    border-radius: 4px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 10px;
    letter-spacing: 0.03em;
    padding: 5px 0;
    cursor: pointer;
    width: 100%;
    margin-bottom: 6px;
  }
  button.new-key:hover { background: color-mix(in srgb, var(--vscode-button-hoverBackground) 50%, transparent); }
  select {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 0.5px solid var(--vscode-input-border, rgba(128,128,128,0.2));
    border-radius: 4px;
    padding: 4px 4px;
    font-size: 10px;
    font-family: var(--vscode-editor-font-family, monospace);
    outline: none;
    cursor: pointer;
    flex-shrink: 0;
  }
  select:focus { border-color: var(--vscode-focusBorder); }

  /* Config accordion */
  details { margin-bottom: 10px; border-bottom: 0.5px solid var(--vscode-panel-border, rgba(128,128,128,0.1)); padding-bottom: 6px; }
  summary {
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
    user-select: none;
  }
  summary::-webkit-details-marker { display: none; }
  summary .chevron { opacity: 0.5; font-size: 10px; transition: transform 0.15s; }
  details[open] summary .chevron { transform: rotate(90deg); }
  .config-body { padding-top: 6px; }
  .candidate-list { margin-bottom: 6px; }
  .candidate-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
    cursor: pointer;
    font-size: 11px;
  }
  .candidate-item input[type="radio"] { flex-shrink: 0; cursor: pointer; }
  .candidate-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.85;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .candidate-path.active { opacity: 1; font-weight: bold; }
  .manual-row { display: flex; gap: 4px; margin-top: 4px; }
  .manual-row input { flex: 1; }
  .config-status { font-size: 10px; opacity: 0.5; margin-top: 4px; }

  /* Keys section */
  #s-keys { }
  .keys-top { margin-bottom: 6px; }
  .keys-top h4 { margin-bottom: 6px; }

  .key-item {
    margin-bottom: 6px;
    border-bottom: 0.5px solid var(--vscode-panel-border, rgba(128,128,128,0.1));
    padding-bottom: 6px;
  }
  .key-header { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
  .key-name { font-size: 10px; font-family: var(--vscode-editor-font-family, monospace); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .locale-row { display: flex; gap: 4px; align-items: baseline; margin-bottom: 3px; }
  .locale-label { width: 20px; flex-shrink: 0; font-size: 9px; opacity: 0.45; font-weight: bold; font-family: var(--vscode-editor-font-family, monospace); }
  .locale-val { flex: 1; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.45; }
  .locale-val.translated { color: var(--vscode-testing-iconPassed, #78c88c); opacity: 1; }
  .locale-val.empty { opacity: 0.25; font-style: italic; }
  .locale-val .var-pill { color: var(--vscode-symbolIcon-variableForeground, #4fc1ff); opacity: 1; }
  .locale-row input { flex: 1; font-size: 10px; }
  .save-row { margin-top: 4px; display: flex; justify-content: flex-end; gap: 4px; }
  .error { color: var(--vscode-errorForeground); font-size: 10px; margin-top: 4px; }
  .empty-msg { opacity: 0.5; font-size: 10px; }
  .update-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--vscode-notificationsInfoIcon-foreground, #3794ff);
    display: inline-block; flex-shrink: 0; margin-left: 4px;
  }
  .keys-list-wrap { position: relative; }
  .keys-list-wrap::after {
    content: ''; position: sticky; bottom: 0; display: block;
    height: 24px; margin-top: -24px;
    background: linear-gradient(transparent, var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e)));
    pointer-events: none;
  }
</style>
</head>
<body>

<details id="configDetails">
  <summary>
    <span class="chevron">▶</span>
    <h4 style="margin:0">Config</h4>
    <span id="configSummaryPath" style="font-size:9px;opacity:0.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;margin-left:4px;font-family:var(--vscode-editor-font-family,monospace)"></span>
  </summary>
  <div class="config-body">
    <div id="candidateList" class="candidate-list"></div>
    <div class="manual-row">
      <input id="configPath" type="text" placeholder="or paste path manually…" />
      <button id="loadConfig">Load</button>
    </div>
    <div id="configError" class="error"></div>
  </div>
</details>
<button id="installRulesBtn" class="secondary" style="width:100%;font-size:10px;margin-bottom:8px;display:none;align-items:center;justify-content:center;gap:6px">
  <span class="update-dot"></span>Update agent rules
</button>

<section id="s-keys">
  <div class="keys-top">
    <h4>Keys</h4>
  </div>
  <button id="newKeyBtn" class="new-key" title="New Translation Key (⌘⇧T)">+ New Key</button>
  <div class="search-row" style="display:flex;gap:4px;margin-bottom:8px">
    <input id="searchInput" type="text" placeholder="Search keys…" style="flex:1;min-width:0" />
    <select id="searchLocale" title="Search in locale">
      <option value="__all__">all</option>
    </select>
  </div>
  <div class="keys-list-wrap"><div id="keysList"></div></div>
</section>

<script>
  const vscode = acquireVsCodeApi();
  let state = { configPath: '', candidates: [], locales: [], baseLocale: '', keys: [], currentFileKeys: [], localeMap: {}, agentStatus: { installedIn: [], needsUpdate: false }, poirotVersion: '1' };
  let searchQuery = '';
  let searchLocale = '__all__';
  let searchTimer = null;
  const editingKeys = new Set();
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
  document.getElementById('searchLocale').addEventListener('change', (e) => {
    searchLocale = e.target.value;
    renderKeys();
  });
  document.getElementById('installRulesBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'installAgentRulesRequest' });
  });

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'state') {
      state = msg;
      renderConfig();
      renderAgentRules();
      renderLocaleDropdown();
      renderKeys();
    } else if (msg.type === 'error') {
      document.getElementById('configError').textContent = msg.message;
    } else if (msg.type === 'openEditKey') {
      editingKeys.add(msg.key);
      renderKeys();
      setTimeout(() => {
        const el = document.querySelector(\`[data-key-item="\${msg.key}"]\`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    }
  });

  function renderConfig() {
    const { configPath, candidates } = state;
    const details = document.getElementById('configDetails');
    const summaryPath = document.getElementById('configSummaryPath');
    const list = document.getElementById('candidateList');

    // Summary line shows short name of active config
    summaryPath.textContent = configPath ? configPath.split('/').slice(-3).join('/') : '';

    // Auto-collapse when exactly one candidate is found and it's already active
    if (candidates.length === 1 && configPath === candidates[0]) {
      details.removeAttribute('open');
    } else if (!configPath) {
      details.setAttribute('open', '');
    }

    // Render radio list
    if (candidates.length === 0) {
      list.innerHTML = '';
      return;
    }
    list.innerHTML = candidates.map(c => {
      const shortPath = c.split('/').slice(-4).join('/');
      const isActive = c === configPath;
      return \`<label class="candidate-item">
        <input type="radio" name="candidate" value="\${escHtml(c)}" \${isActive ? 'checked' : ''} />
        <span class="candidate-path\${isActive ? ' active' : ''}" title="\${escHtml(c)}">\${escHtml(shortPath)}</span>
      </label>\`;
    }).join('');

    list.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.addEventListener('change', () => {
        if (radio.checked) vscode.postMessage({ type: 'setConfigPath', path: radio.value });
      });
    });
  }

  function renderAgentRules() {
    const { agentStatus } = state;
    const btn = document.getElementById('installRulesBtn');
    if (!agentStatus) return;
    const show = agentStatus.needsUpdate;
    btn.style.display = show ? 'flex' : 'none';
  }

  function renderLocaleDropdown() {
    const sel = document.getElementById('searchLocale');
    const { locales } = state;
    // preserve current selection if still valid
    const prev = searchLocale;
    sel.innerHTML = '<option value="__all__">all</option>' +
      locales.map(l => \`<option value="\${escHtml(l)}">\${escHtml(l)}</option>\`).join('');
    if (locales.includes(prev)) {
      sel.value = prev;
    } else {
      searchLocale = '__all__';
      sel.value = '__all__';
    }
  }

  function displayLocales(baseLocale, allLocales) {
    const others = allLocales.filter(l => l !== baseLocale).sort().slice(0, 2);
    return [baseLocale, ...others];
  }

  function getVisibleKeys() {
    const { currentFileKeys, localeMap, baseLocale, locales } = state;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return currentFileKeys;
    const allKeys = Object.keys(localeMap[baseLocale] || {}).filter(k => k !== '$schema');
    const searchIn = searchLocale === '__all__' ? locales : [searchLocale];
    return allKeys.filter(k => {
      if (k.toLowerCase().includes(q)) return true;
      return searchIn.some(l => String((localeMap[l] || {})[k] ?? '').toLowerCase().includes(q));
    });
  }

  function renderKeys() {
    const container = document.getElementById('keysList');
    const { locales, baseLocale, localeMap } = state;
    const visibleKeys = getVisibleKeys();
    const q = searchQuery.trim();

    if (!visibleKeys.length) {
      if (q) {
        container.innerHTML = '<div class="empty-msg">No keys match</div>';
        if (q.length > 3 && !reindexedQueries.has(q)) {
          reindexedQueries.add(q);
          vscode.postMessage({ type: 'reindexAndSearch', query: q });
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
        const valClass = isEmpty ? 'empty' : 'translated';
        return \`<div class="locale-row">
          <span class="locale-label">\${escHtml(locale)}</span>
          <span class="locale-val \${valClass}">\${isEmpty ? 'empty' : highlightVars(val)}</span>
        </div>\`;
      }).join('');

      const searchBtn = \`<button class="icon search-btn" data-key="\${escHtml(key)}" title="Find usages"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" style="pointer-events:none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m17 17l4 4M3 11a8 8 0 1 0 16 0a8 8 0 0 0-16 0" /></svg></button>\`;
      const editBtn = \`<button class="icon edit-btn" data-key="\${escHtml(key)}" title="Edit"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" style="pointer-events:none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m14.363 5.652l1.48-1.48a2 2 0 0 1 2.829 0l1.414 1.414a2 2 0 0 1 0 2.828l-1.48 1.48m-4.243-4.242l-9.616 9.615a2 2 0 0 0-.578 1.238l-.242 2.74a1 1 0 0 0 1.084 1.085l2.74-.242a2 2 0 0 0 1.24-.578l9.615-9.616m-4.243-4.242l4.243 4.242" /></svg></button>\`;
      const saveRow = isEditing ? \`<div class="save-row">
        <button class="secondary cancel-btn" data-key="\${escHtml(key)}">Cancel</button>
        <button class="save-btn" data-key="\${escHtml(key)}">Save</button>
      </div>\` : '';

      return \`<div class="key-item" data-key-item="\${escHtml(key)}">
        <div class="key-header">
          <span class="key-name">\${escHtml(key)}</span>
          \${!isEditing ? searchBtn + editBtn : ''}
        </div>
        \${localeRows}
        \${saveRow}
      </div>\`;
    }).join('');

    container.querySelectorAll('.search-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'findUsages', key: btn.dataset.key });
      });
    });
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

  function highlightVars(s) {
    return escHtml(s).replace(/\{([^}]+)\}/g, '<span class="var-pill">{$1}</span>');
  }

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
