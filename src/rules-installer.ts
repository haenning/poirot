import fs from "fs";
import path from "path";

export const POIROT_VERSION = "8";
const MARKER_START = "##poirot##";
const MARKER_END = "##poirot##";

export interface AgentContext {
  /** Which agent files were found */
  cursorRules: string[];   // .cursor/rules/*.mdc paths
  cursorRulesLegacy: string | null; // .cursorrules
  claudeMd: string | null; // CLAUDE.md or .claude/CLAUDE.md
  /** Where poirot is already installed */
  installedIn: string[];
}

export interface InstallResult {
  written: string[];
  skipped: string[];
  errors: string[];
}

function poirotBlock(mcpServerPath: string, settingsPath: string | undefined): string {
  return `${MARKER_START}
<!-- Poirot v${POIROT_VERSION} — do not edit between markers -->
Use poirot MCP tools for all i18n in *.svelte, *.tsx, *.jsx, *.ts, *.js, *.vue, *.astro. Never hardcode user-visible strings.

Workflow:
1. get_i18n_config — project locales and paths when unsure.
2. bulk_lookup_translations / get_translations / list_translation_keys / scan_file_keys — discover or fetch keys before editing.
3. find_key_usages — before rename or delete; check all references.
4. create_translation_keys — only for strings with no suitable match. Returns paste-ready m.key() with {param: a} slots for placeholders.
5. set_translation_values / rename_translation_keys — fix or rename entries.
6. validate_placeholders / report_missing_translations — mid-session checks (no compile).
7. auto_translate — once at end of session.
8. check_paraglide — after larger batches (includes compile).
9. delete_translation_keys — remove orphans; use onlyIfUnused to skip keys still in code.
${MARKER_END}`;
}

function poirotMdcContent(mcpServerPath: string, settingsPath: string | undefined): string {
  return `---
globs: ["**/*.svelte","**/*.tsx","**/*.jsx","**/*.ts","**/*.js","**/*.vue","**/*.astro"]
alwaysApply: false
---

${poirotBlock(mcpServerPath, settingsPath)}
`;
}

function hasPoirotMarker(content: string): boolean {
  return content.includes(MARKER_START);
}

function getInstalledVersion(content: string): string | null {
  const m = content.match(/<!-- Poirot v(\d+) —/);
  return m ? m[1] : null;
}

function injectOrUpdateBlock(existing: string, block: string): string {
  if (!hasPoirotMarker(existing)) {
    // Append with a blank line separator
    return existing.trimEnd() + "\n\n" + block + "\n";
  }
  // Replace between markers (inclusive)
  const startIdx = existing.indexOf(MARKER_START);
  const endIdx = existing.indexOf(MARKER_END, startIdx + MARKER_START.length) + MARKER_END.length;
  return existing.slice(0, startIdx) + block + existing.slice(endIdx);
}

export function detectAgents(projectDir: string): AgentContext {
  const result: AgentContext = {
    cursorRules: [],
    cursorRulesLegacy: null,
    claudeMd: null,
    installedIn: [],
  };

  // .cursor/rules/ directory (Cursor >=0.43)
  const cursorRulesDir = path.join(projectDir, ".cursor", "rules");
  try {
    const files = fs.readdirSync(cursorRulesDir).filter((f) => f.endsWith(".mdc"));
    for (const f of files) {
      const p = path.join(cursorRulesDir, f);
      result.cursorRules.push(p);
      const content = fs.readFileSync(p, "utf8");
      if (hasPoirotMarker(content)) result.installedIn.push(p);
    }
  } catch { /* dir doesn't exist */ }

  // .cursorrules (legacy)
  const legacy = path.join(projectDir, ".cursorrules");
  try {
    const content = fs.readFileSync(legacy, "utf8");
    result.cursorRulesLegacy = legacy;
    if (hasPoirotMarker(content)) result.installedIn.push(legacy);
  } catch { /* doesn't exist */ }

  // CLAUDE.md at project root or .claude/CLAUDE.md
  for (const p of [
    path.join(projectDir, "CLAUDE.md"),
    path.join(projectDir, ".claude", "CLAUDE.md"),
  ]) {
    try {
      const content = fs.readFileSync(p, "utf8");
      result.claudeMd = p;
      if (hasPoirotMarker(content)) result.installedIn.push(p);
      break;
    } catch { /* doesn't exist */ }
  }

  return result;
}

export function needsUpdate(projectDir: string): boolean {
  const ctx = detectAgents(projectDir);

  // Outdated version in any installed file
  for (const p of ctx.installedIn) {
    try {
      const v = getInstalledVersion(fs.readFileSync(p, "utf8"));
      if (v !== POIROT_VERSION) return true;
    } catch { /* ignore */ }
  }

  // .cursor folder exists but poirot.mdc not yet written
  const mdcPath = path.join(projectDir, ".cursor", "rules", "poirot.mdc");
  if (fs.existsSync(path.join(projectDir, ".cursor")) && !fs.existsSync(mdcPath)) return true;

  // CLAUDE.md or .claude/CLAUDE.md exists but has no poirot block
  for (const p of [
    path.join(projectDir, "CLAUDE.md"),
    path.join(projectDir, ".claude", "CLAUDE.md"),
  ]) {
    if (fs.existsSync(p) && !ctx.installedIn.includes(p)) return true;
  }

  return false;
}

export function installRules(
  mcpServerPath: string,
  settingsPath: string | undefined,
  projectDir: string
): InstallResult {
  const result: InstallResult = { written: [], skipped: [], errors: [] };
  const ctx = detectAgents(projectDir);
  const block = poirotBlock(mcpServerPath, settingsPath);

  // Helper: write or update a text file with the poirot block injected
  function upsertFile(filePath: string, fallbackContent: string) {
    try {
      let existing = "";
      try { existing = fs.readFileSync(filePath, "utf8"); } catch { existing = fallbackContent; }
      const updated = injectOrUpdateBlock(existing, block);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, updated, "utf8");
      result.written.push(filePath);
    } catch (err) {
      result.errors.push(`${filePath}: ${String(err)}`);
    }
  }

  // Cursor: write poirot.mdc if .cursor folder exists (rules subdir created if needed)
  const cursorDir = path.join(projectDir, ".cursor");
  const mdcPath = path.join(cursorDir, "rules", "poirot.mdc");
  if (fs.existsSync(cursorDir)) {
    try {
      fs.mkdirSync(path.dirname(mdcPath), { recursive: true });
      fs.writeFileSync(mdcPath, poirotMdcContent(mcpServerPath, settingsPath), "utf8");
      result.written.push(mdcPath);
    } catch (err) {
      result.errors.push(`${mdcPath}: ${String(err)}`);
    }
  } else if (ctx.cursorRulesLegacy) {
    // Legacy .cursorrules — inject block
    upsertFile(ctx.cursorRulesLegacy, "");
  }

  // Claude: inject/update block only when CLAUDE.md already exists
  if (ctx.claudeMd) {
    upsertFile(ctx.claudeMd, "");
  }

  return result;
}
