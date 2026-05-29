import path from "path";

/** Ensure resolved target stays inside baseDir (project root). */
export function assertPathContained(baseDir: string, targetPath: string): void {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath);
  const rel = path.relative(base, target);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Path escapes project directory: ${targetPath}`);
  }
}

export function isPathInsideRoots(filePath: string, roots: string[]): boolean {
  if (roots.length === 0) return false;
  const resolved = path.resolve(filePath);
  return roots.some((root) => {
    const rel = path.relative(path.resolve(root), resolved);
    return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
  });
}

export function validateLocaleCode(locale: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(locale)) {
    throw new Error(`Invalid locale code: ${locale}`);
  }
}

export function validatePathPattern(pattern: string): void {
  if (pattern.includes("..")) {
    throw new Error(`Invalid path pattern: ${pattern}`);
  }
}
