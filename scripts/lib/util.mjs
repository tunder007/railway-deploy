// Shared helpers (standalone so the skill is portable). Deterministic: no random, no clock.
import fs from "node:fs";
import path from "node:path";

export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const posix = (p) => p.split(path.sep).join("/");
export const readText = (abs) => { try { return fs.readFileSync(abs, "utf8"); } catch { return null; } };
export const exists = (abs) => { try { fs.accessSync(abs); return true; } catch { return false; } };

// Mask a secret VALUE for safe display: keep at most the first 2 chars, replace the rest with •.
// Empty / very short values collapse to a fixed marker so length isn't leaked either.
export function maskSecret(value) {
  const v = String(value ?? "");
  if (v.length === 0) return "(empty)";
  if (v.length <= 4) return "••••";
  return v.slice(0, 2) + "•".repeat(8); // fixed-length tail: never reveals real length
}

// Parse a dotenv-style file into an ordered list of KEYS only (values are never returned upstream).
// Tolerates `export KEY=...`, comments, and blank lines.
export function parseEnvKeys(text) {
  if (text == null) return [];
  const keys = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.replace(/^export\s+/, "").match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

export const DIRS_TO_SKIP = new Set([
  ".git", "node_modules", ".next", "dist", "build", "coverage",
  ".vercel", ".turbo", ".cache"
]);

// Recursively list repo-relative posix file paths under `absDir`, honoring DIRS_TO_SKIP.
// Deterministic ordering. Caps total files to keep the scan bounded on huge trees.
export function walkFiles(absDir, { cap = 5000 } = {}) {
  const out = [];
  (function recur(d) {
    if (out.length >= cap) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => cmp(a.name, b.name));
    for (const e of entries) {
      if (out.length >= cap) return;
      if (DIRS_TO_SKIP.has(e.name)) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) recur(abs);
      else if (e.isFile()) out.push(posix(path.relative(absDir, abs)));
    }
  })(absDir);
  return out.sort(cmp);
}

export { fs, path };
