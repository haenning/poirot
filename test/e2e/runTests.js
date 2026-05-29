const path = require("path");
const {
  runTests,
  downloadAndUnzipVSCode,
  resolveCliPathFromVSCodeExecutablePath,
} = require("@vscode/test-electron");

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");
    const extensionTestsPath = path.resolve(__dirname, "./suite");
    const testWorkspace = path.resolve(__dirname, "../fixtures/minimal-inlang");

    const vscodeExecutablePath = await downloadAndUnzipVSCode({ version: "stable" });
    const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);

    await runTests({
      vscodeExecutablePath: cliPath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [testWorkspace, "--disable-extensions"],
    });
  } catch (err) {
    console.error("Failed to run tests", err);
    process.exit(1);
  }
}

main();
