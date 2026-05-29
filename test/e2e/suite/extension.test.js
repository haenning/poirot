const assert = require("assert");
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

suite("Poirot extension E2E", () => {
  vscode.window.showInformationMessage("Start Poirot E2E tests.");

  test("registers core commands", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("poirot.newKey"), "poirot.newKey should be registered");
    assert.ok(commands.includes("poirot.goToKey"), "poirot.goToKey should be registered");
    assert.ok(commands.includes("poirot.editKey"), "poirot.editKey should be registered");
  });

  test("auto-discovers inlang settings in workspace", async function () {
    this.timeout(15000);
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, "workspace folder should be open");
    const settingsPath = path.join(workspaceRoot, "project.inlang", "settings.json");
    assert.ok(fs.existsSync(settingsPath), "settings.json should exist in fixture workspace");
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.strictEqual(raw.baseLocale, "en");
  });

  test("opens sample file with m.key() call", async function () {
    this.timeout(15000);
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const samplePath = path.join(workspaceRoot, "src", "sample.ts");
    const doc = await vscode.workspace.openTextDocument(samplePath);
    const editor = await vscode.window.showTextDocument(doc);
    assert.ok(editor.document.getText().includes("m.hello_world()"));
  });
});
