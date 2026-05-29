import fs from "fs";
import path from "path";
import { assertPathContained } from "./path-security";
import { scanKeyMatchesFromText } from "./scan-keys";

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".svelte-kit",
  "coverage",
  ".poirot",
  ".vscode-test",
]);

const SOURCE_EXTENSIONS = new Set([
  ".svelte",
  ".tsx",
  ".jsx",
  ".ts",
  ".js",
  ".vue",
  ".astro",
]);

export interface KeyUsageHit {
  file: string;
  line: number;
}

export interface KeyUsageResult {
  key: string;
  hits: KeyUsageHit[];
}

function lineNumberAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function normalizeIncludePrefixes(include?: string[]): string[] | null {
  if (!include || include.length === 0) return null;
  return include.map((p) =>
    p.replace(/\\/g, "/").replace(/\/\*\*.*$/, "").replace(/\/$/, "")
  );
}

function isUnderInclude(relPath: string, prefixes: string[] | null): boolean {
  if (!prefixes) return true;
  const norm = relPath.replace(/\\/g, "/");
  return prefixes.some((p) => norm === p || norm.startsWith(`${p}/`));
}

async function walkSourceFiles(
  dir: string,
  projectDir: string,
  includePrefixes: string[] | null,
  files: string[]
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      await walkSourceFiles(fullPath, projectDir, includePrefixes, files);
      continue;
    }

    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!SOURCE_EXTENSIONS.has(ext)) continue;

    const relPath = path.relative(projectDir, fullPath);
    if (!isUnderInclude(relPath, includePrefixes)) continue;
    files.push(fullPath);
  }
}

export function resolveProjectFile(projectDir: string, filePath: string): string {
  const resolved = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(projectDir, filePath);
  assertPathContained(projectDir, resolved);
  return resolved;
}

export function scanFileKeysFromText(text: string): string[] {
  return [...new Set(scanKeyMatchesFromText(text).map((m) => m.key))];
}

export async function scanFileKeys(
  projectDir: string,
  filePath: string
): Promise<{ file: string; keys: string[] }> {
  const resolved = resolveProjectFile(projectDir, filePath);
  const text = await fs.promises.readFile(resolved, "utf8");
  const rel = path.relative(projectDir, resolved).replace(/\\/g, "/");
  return { file: rel, keys: scanFileKeysFromText(text) };
}

export async function findKeyUsages(
  projectDir: string,
  keys: string[],
  include?: string[]
): Promise<KeyUsageResult[]> {
  const keySet = new Set(keys);
  const hitsByKey = new Map<string, KeyUsageHit[]>();
  for (const key of keys) {
    hitsByKey.set(key, []);
  }

  const files: string[] = [];
  await walkSourceFiles(
    projectDir,
    projectDir,
    normalizeIncludePrefixes(include),
    files
  );

  for (const filePath of files) {
    let text: string;
    try {
      text = await fs.promises.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    const rel = path.relative(projectDir, filePath).replace(/\\/g, "/");
    for (const { key, index } of scanKeyMatchesFromText(text)) {
      if (!keySet.has(key)) continue;
      hitsByKey.get(key)!.push({ file: rel, line: lineNumberAt(text, index) });
    }
  }

  return keys.map((key) => ({
    key,
    hits: hitsByKey.get(key) ?? [],
  }));
}

export function formatKeyUsages(results: KeyUsageResult[]): string {
  return results
    .map(({ key, hits }) => {
      if (hits.length === 0) {
        return `m.${key}(): (no usages)`;
      }
      const lines = hits.map((h) => `  ${h.file}:${h.line}`).join("\n");
      return `m.${key}():\n${lines}`;
    })
    .join("\n\n");
}

export function formatScanFileKeys(result: { file: string; keys: string[] }): string {
  if (result.keys.length === 0) {
    return `${result.file}: (no m.key() calls)`;
  }
  const refs = result.keys.map((k) => `m.${k}()`).join(", ");
  return `${result.file}: ${refs}`;
}
