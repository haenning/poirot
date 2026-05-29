import * as vscode from "vscode";
import { SidebarProvider } from "./sidebar";
import { DecorationManager } from "./decorations";
import { spawnMcpServer, stopMcpServer, restartMcpServer, writeCursorConfig } from "./mcp-spawn";

let mcpServerPath = "";
let reloadHandler: (() => void) | undefined;

export function activate(context: vscode.ExtensionContext): void {
  mcpServerPath = context.asAbsolutePath("dist/mcp-server.js");
  const decorations = new DecorationManager(context);
  const provider = new SidebarProvider(context, decorations, mcpServerPath);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("poirot.sidebar", provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("poirot.newKey", () => {
      provider.handleNewKeyCommand();
    })
  );

  const storedSettings = context.workspaceState.get<string>("inlangSettingsPath");
  reloadHandler = () => provider.reloadLocales();

  spawnMcpServer(mcpServerPath, storedSettings, reloadHandler);

  if (vscode.workspace.getConfiguration("poirot").get<boolean>("autoConfigureCursorMcp", true)) {
    writeCursorConfig(mcpServerPath, storedSettings);
  }

  provider.onConfigLoaded = (settingsPath) => {
    restartMcpServer(mcpServerPath, settingsPath, reloadHandler!);
    if (vscode.workspace.getConfiguration("poirot").get<boolean>("autoConfigureCursorMcp", true)) {
      writeCursorConfig(mcpServerPath, settingsPath);
    }
  };

  decorations.onEditKey = (key) => provider.openEditKey(key);

  provider.tryAutoDiscover();
}

export function deactivate(): void {
  stopMcpServer();
  reloadHandler = undefined;
}
