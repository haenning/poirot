import * as vscode from "vscode";
import { SidebarProvider } from "./sidebar";
import { spawnMcpServer, writeCursorConfig } from "./mcp-spawn";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SidebarProvider(context);

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
}

export function deactivate(): void {}
