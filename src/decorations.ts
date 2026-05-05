import * as vscode from "vscode";
import { InlangConfig, LocaleMap, resolveLocalePath } from "./inlang";

const M_FUNC_RE = /\bm\.([a-z][a-z0-9_]*)\(\)/g;

const LINE_COMMENT_RE = /^\s*\/\//;

function blockCommentRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("/*", i);
    if (open === -1) break;
    const close = text.indexOf("*/", open + 2);
    if (close === -1) { ranges.push([open, text.length]); break; }
    ranges.push([open, close + 2]);
    i = close + 2;
  }
  return ranges;
}

function isInBlockComment(offset: number, ranges: Array<[number, number]>): boolean {
  for (const [s, e] of ranges) {
    if (offset >= s && offset < e) return true;
  }
  return false;
}

class PoirotCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  private _config?: InlangConfig;
  private _localeMap?: LocaleMap;

  update(config: InlangConfig, localeMap: LocaleMap): void {
    this._config = config;
    this._localeMap = localeMap;
    this._onDidChange.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this._config || !this._localeMap) return [];

    const text = document.getText();
    const baseLocale = this._config.baseLocale;
    const baseMessages = this._localeMap[baseLocale] ?? {};
    const blockRanges = blockCommentRanges(text);
    const lenses: vscode.CodeLens[] = [];
    // one lens per line — track which lines already have one
    const seenLines = new Set<number>();

    M_FUNC_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = M_FUNC_RE.exec(text)) !== null) {
      const key = match[1];
      if (isInBlockComment(match.index, blockRanges)) continue;
      const pos = document.positionAt(match.index);
      if (LINE_COMMENT_RE.test(document.lineAt(pos.line).text)) continue;
      if (!baseMessages[key]) continue;
      if (seenLines.has(pos.line)) continue;
      seenLines.add(pos.line);

      const range = new vscode.Range(pos, pos);
      lenses.push(new vscode.CodeLens(range, {
        title: "↗ open in " + baseLocale + ".json",
        command: "poirot.goToKey",
        arguments: [key],
      }));
      lenses.push(new vscode.CodeLens(range, {
        title: "✎ edit",
        command: "poirot.editKey",
        arguments: [key],
      }));
      lenses.push(new vscode.CodeLens(range, {
        title: "⌕ find usages",
        command: "workbench.action.findInFiles",
        arguments: [{ query: `m.${key}()`, triggerSearch: true, isRegex: false, filesToInclude: "src" }],
      }));
    }

    return lenses;
  }
}

export class DecorationManager {
  private readonly _decorationType: vscode.TextEditorDecorationType;
  private readonly _goToKeyCommand: vscode.Disposable;
  private readonly _editKeyCommand: vscode.Disposable;
  private readonly _codeLensProvider: PoirotCodeLensProvider;
  private _config?: InlangConfig;
  private _localeMap?: LocaleMap;
  onEditKey?: (key: string) => void;

  constructor(context: vscode.ExtensionContext) {
    this._decorationType = vscode.window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });

    this._codeLensProvider = new PoirotCodeLensProvider();

    this._goToKeyCommand = vscode.commands.registerCommand(
      "poirot.goToKey",
      async (key: string) => {
        if (!this._config) return;
        const filePath = resolveLocalePath(this._config, this._config.baseLocale);
        const doc = await vscode.workspace.openTextDocument(filePath);
        const text = doc.getText();
        const lines = text.split("\n");
        const lineIdx = lines.findIndex((l) => {
          const re = new RegExp(`"${key}"\\s*:`);
          return re.test(l);
        });
        const editor = await vscode.window.showTextDocument(doc);
        if (lineIdx >= 0) {
          const pos = new vscode.Position(lineIdx, 0);
          editor.selection = new vscode.Selection(pos, pos);
          editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }
      }
    );

    this._editKeyCommand = vscode.commands.registerCommand(
      "poirot.editKey",
      (key: string) => {
        vscode.commands.executeCommand("poirot.sidebar.focus");
        this.onEditKey?.(key);
      }
    );

    context.subscriptions.push(
      this._decorationType,
      this._goToKeyCommand,
      this._editKeyCommand,
      vscode.languages.registerCodeLensProvider(
        [
          { scheme: "file", language: "svelte" },
          { scheme: "file", language: "typescript" },
          { scheme: "file", language: "typescriptreact" },
          { scheme: "file", language: "javascript" },
          { scheme: "file", language: "javascriptreact" },
          { scheme: "file", language: "vue" },
          { scheme: "file", language: "astro" },
        ],
        this._codeLensProvider
      ),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) this._applyToEditor(editor);
      })
    );
  }

  update(config: InlangConfig, localeMap: LocaleMap): void {
    this._config = config;
    this._localeMap = localeMap;
    this._codeLensProvider.update(config, localeMap);
    const editor = vscode.window.activeTextEditor;
    if (editor) this._applyToEditor(editor);
  }

  refresh(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor) this._applyToEditor(editor);
  }

  private _applyToEditor(editor: vscode.TextEditor): void {
    if (!this._config || !this._localeMap) {
      editor.setDecorations(this._decorationType, []);
      return;
    }

    const doc = editor.document;
    const text = doc.getText();
    const baseLocale = this._config.baseLocale;
    const baseMessages = this._localeMap[baseLocale] ?? {};
    const blockRanges = blockCommentRanges(text);
    const decorations: vscode.DecorationOptions[] = [];

    M_FUNC_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = M_FUNC_RE.exec(text)) !== null) {
      const offset = match.index;
      const key = match[1];

      // Skip block comments
      if (isInBlockComment(offset, blockRanges)) continue;

      // Skip single-line comments
      const pos = doc.positionAt(offset);
      const lineText = doc.lineAt(pos.line).text;
      if (LINE_COMMENT_RE.test(lineText)) continue;

      const value = baseMessages[key];
      if (!value) continue;

      const endPos = doc.positionAt(offset + match[0].length);
      const range = new vscode.Range(pos, endPos);

      const truncated = value.length > 48 ? value.slice(0, 46) + "…" : value;
      const md = new vscode.MarkdownString(
        `[↗ open in ${baseLocale}.json](command:poirot.goToKey?${encodeURIComponent(JSON.stringify(key))})`
      );
      md.isTrusted = true;

      decorations.push({
        range,
        renderOptions: {
          after: {
            contentText: ` ${truncated} `,
            color: new vscode.ThemeColor("editorCodeLens.foreground"),
            backgroundColor: new vscode.ThemeColor("editor.background"),
            border: "1px solid",
            borderColor: new vscode.ThemeColor("editorCodeLens.foreground"),
            borderRadius: "3px",
            fontStyle: "italic",
            margin: "0 0 0 8px",
          },
        },
        hoverMessage: md,
      });
    }

    editor.setDecorations(this._decorationType, decorations);
  }
}
