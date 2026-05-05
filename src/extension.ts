import * as vscode from "vscode";
import { SidebarProvider } from "./sidebar";
import { spawnMcpServer, writeCursorConfig } from "./mcp-spawn";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SidebarProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("paraglideHelper.sidebar", provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("paraglideHelper.newKey", () => {
      provider.handleNewKeyCommand();
    })
  );

  const mcpServerPath = context.asAbsolutePath("dist/mcp-server.js");
  spawnMcpServer(mcpServerPath);
  writeCursorConfig(mcpServerPath);
}

export function deactivate(): void {}
