import * as vscode from "vscode";
import { SidebarProvider } from "./sidebar";
import { DecorationManager } from "./decorations";
import { spawnMcpServer, writeCursorConfig } from "./mcp-spawn";

export function activate(context: vscode.ExtensionContext): void {
  const decorations = new DecorationManager(context);
  const provider = new SidebarProvider(context, decorations);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("poirot.sidebar", provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("poirot.newKey", () => {
      provider.handleNewKeyCommand();
    })
  );

  const mcpServerPath = context.asAbsolutePath("dist/mcp-server.js");
  const storedSettings = context.workspaceState.get<string>("inlangSettingsPath");

  spawnMcpServer(mcpServerPath, storedSettings, () => provider.reloadLocales());
  writeCursorConfig(mcpServerPath, storedSettings);

  provider.onConfigLoaded = (settingsPath) => {
    writeCursorConfig(mcpServerPath, settingsPath);
  };

  decorations.onEditKey = (key) => provider.openEditKey(key);

  // Auto-load config immediately on activation so decorations work without opening the sidebar
  provider.tryAutoDiscover();
}

export function deactivate(): void {}
