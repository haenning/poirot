import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { detectAgents, installRules, needsUpdate, POIROT_VERSION } from "./rules-installer";

describe("rules-installer", () => {
  let projectDir = "";

  beforeEach(async () => {
    projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "poirot-rules-"));
  });

  afterEach(async () => {
    await fs.promises.rm(projectDir, { recursive: true, force: true });
  });

  it("detectAgents finds cursor rules directory", async () => {
    const rulesDir = path.join(projectDir, ".cursor", "rules");
    await fs.promises.mkdir(rulesDir, { recursive: true });
    await fs.promises.writeFile(path.join(rulesDir, "other.mdc"), "# rules\n", "utf8");
    const ctx = detectAgents(projectDir);
    expect(ctx.cursorRules.length).toBe(1);
  });

  it("does not create CLAUDE.md when missing", () => {
    fs.mkdirSync(path.join(projectDir, ".cursor"), { recursive: true });
    const result = installRules("/fake/mcp.js", undefined, projectDir);
    expect(fs.existsSync(path.join(projectDir, "CLAUDE.md"))).toBe(false);
    expect(result.written.some((p) => p.endsWith("poirot.mdc"))).toBe(true);
  });

  it("updates existing CLAUDE.md with poirot block", async () => {
    const claudePath = path.join(projectDir, "CLAUDE.md");
    await fs.promises.writeFile(claudePath, "# Project\n", "utf8");
    installRules("/fake/mcp.js", undefined, projectDir);
    const content = await fs.promises.readFile(claudePath, "utf8");
    expect(content).toContain("##poirot##");
    expect(content).toContain(`Poirot v${POIROT_VERSION}`);
  });

  it("needsUpdate when poirot.mdc missing but .cursor exists", () => {
    fs.mkdirSync(path.join(projectDir, ".cursor"), { recursive: true });
    expect(needsUpdate(projectDir)).toBe(true);
  });

  it("needsUpdate when agent rules block version is outdated", () => {
    fs.mkdirSync(path.join(projectDir, ".cursor", "rules"), { recursive: true });
    const mdc = path.join(projectDir, ".cursor", "rules", "poirot.mdc");
    fs.writeFileSync(
      mdc,
      `<!-- Poirot v4 — do not edit between markers -->\n##poirot##\nold\n##poirot##\n`,
      "utf8"
    );
    expect(needsUpdate(projectDir)).toBe(true);
  });
});
