// Core: pure planning + scanning. NO side effects, NO network, NO railway calls live here.
// Used by the CLI (deploy.mjs) and the self-test, so behavior is identical and testable.
//
// planDeploy(dir, opts) → { dir, preflight, envMissing, secretFindings, migrations, command, deploy }
//   preflight       : { railwayOnPath, projectLinked, hasEnvExample, notes:[] }
//   envMissing      : [ KEYS present in .env.example but not configured locally ]
//   secretFindings  : [ { file, kind, masked, line } ]  ← values ALWAYS masked
//   migrations      : { detected, command|null, idempotentNote }
//   command         : the exact `railway up` command we WOULD run (string)
//   deploy          : false in dry-run; true only when --deploy passed (still never executed by core)

import { fs, path, posix, readText, exists, parseEnvKeys, maskSecret, walkFiles } from "./util.mjs";

// --- secret patterns (deterministic, conservative) -------------------------------------------
// Each: a kind label + a regex with a capture group #1 for the secret VALUE (so we can mask it).
// We only flag values that look like real secrets, not empty assignments or obvious placeholders.
// `["']?\s*[:=]` tolerates JSON (`"KEY": "val"`) and dotenv (`KEY=val`) alike.
const SECRET_PATTERNS = [
  { kind: "db-password",      re: /\b(?:DB_PASSWORD|MYSQL_PASSWORD|POSTGRES_PASSWORD|PGPASSWORD)["']?\s*[:=]\s*["']?([^"'\s,}]+)/gi },
  { kind: "railway-token",    re: /\b(?:RAILWAY_TOKEN|RAILWAY_API_TOKEN)["']?\s*[:=]\s*["']?([^"'\s,}]+)/gi },
  { kind: "generic-token",    re: /\b(?:API_KEY|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN|PRIVATE_KEY)["']?\s*[:=]\s*["']?([^"'\s,}]+)/gi },
  { kind: "connection-string", re: /\b(?:mysql|postgres|postgresql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s"']+:([^@\s"']+)@/gi },
];

// Values that are clearly placeholders, not live secrets → never flag these.
const PLACEHOLDER = /^(?:|\$\{?[\w-]*\}?|<[^>]*>?|your[_-]?\w*|changeme|placeholder|xxx+|example|null|undefined|true|false)$/i;

// Files where committed plaintext secrets are a real problem (the .claude/settings*.json case).
// We scan ALL tracked-ish files but elevate these to a higher-signal "kind" context.
const SENSITIVE_FILES = /(?:settings(?:\.local)?\.json|\.env(?:\.[\w.-]+)?$|config\.(?:json|cjs|js))/i;

// Scan one file's text for secret-looking assignments. Returns findings with MASKED values only.
export function scanText(relFile, text) {
  const findings = [];
  if (text == null) return findings;
  const lines = text.split(/\r?\n/);
  for (const { kind, re } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const value = m[1];
      if (value == null || PLACEHOLDER.test(value)) continue;
      // locate 1-based line number of this match
      const upto = text.slice(0, m.index);
      const line = upto.split(/\r?\n/).length;
      findings.push({ file: relFile, kind, masked: maskSecret(value), line });
    }
  }
  // de-dupe identical (file,kind,line) and sort deterministically
  const seen = new Set();
  return findings
    .filter((f) => { const k = `${f.file}|${f.kind}|${f.line}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
}

// Walk a directory tree and scan scannable text files for secrets. Read-only.
export function secretHygieneScan(root) {
  const findings = [];
  const scannable = /\.(json|jsonc|js|cjs|mjs|ts|tsx|env|yml|yaml|toml|conf|cfg|ini|sh)$|(?:^|\/)\.env(?:\.[\w.-]+)?$/i;
  for (const rel of walkFiles(root)) {
    const base = posix(rel);
    if (!scannable.test(base) && !SENSITIVE_FILES.test(base)) continue;
    const text = readText(path.join(root, rel));
    for (const f of scanText(rel, text)) findings.push(f);
  }
  return findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
}

// Is `.env*` ignored by the nearest .gitignore? Best-effort, deterministic.
export function envIsGitignored(root) {
  const gi = readText(path.join(root, ".gitignore"));
  if (gi == null) return { found: false, ignored: false };
  const lines = gi.split(/\r?\n/).map((l) => l.trim());
  const ignored = lines.some((l) => l === ".env" || l === ".env*" || l === ".env.local" || l === "*.env" || l.startsWith(".env"));
  return { found: true, ignored };
}

// Diff required env keys (.env.example) against what's configured locally (.env), KEYS ONLY.
// Returns { hasEnvExample, required:[...], missing:[...] }. Never reads any VALUE upstream.
export function envDiff(root) {
  const exampleText = readText(path.join(root, ".env.example"));
  const required = parseEnvKeys(exampleText);
  // Locally-known keys: union of .env (if present) and the current process env.
  const localText = readText(path.join(root, ".env"));
  const localKeys = new Set([...parseEnvKeys(localText), ...Object.keys(process.env)]);
  const missing = required.filter((k) => !localKeys.has(k)).sort();
  return { hasEnvExample: exampleText != null, required, missing };
}

// Detect migrations (Sequelize-style) and the idempotent command to run them.
export function detectMigrations(root) {
  const pkg = (() => { try { return JSON.parse(readText(path.join(root, "package.json")) || "{}"); } catch { return {}; } })();
  const scripts = pkg.scripts || {};
  const hasMigrateScript = typeof scripts["db:migrate"] === "string";
  const hasMigrationsDir = exists(path.join(root, "migrations"));
  const detected = hasMigrateScript || hasMigrationsDir;
  return {
    detected,
    command: hasMigrateScript ? "railway run npm run db:migrate" : (hasMigrationsDir ? "railway run npx sequelize-cli db:migrate" : null),
    idempotentNote: "Sequelize tracks applied migrations in SequelizeMeta; re-running skips already-applied ones (safe to re-run).",
  };
}

// Read-only preflight. Caller passes `railwayOnPath` (CLI probe done outside the pure core) and
// `projectLinked` so this stays free of side effects and fully testable.
export function preflight(root, { railwayOnPath = false, projectLinked = false } = {}) {
  const env = envDiff(root);
  const gi = envIsGitignored(root);
  const notes = [];
  if (!railwayOnPath) notes.push("railway CLI not found on PATH — install it before deploying.");
  if (!projectLinked) notes.push("project not linked — run `railway link` (or `railway init`) first.");
  if (!env.hasEnvExample) notes.push("no .env.example found — cannot diff required env keys.");
  if (gi.found && !gi.ignored) notes.push(".env* is NOT gitignored — add it to .gitignore.");
  if (!gi.found) notes.push("no .gitignore found — ensure .env* can never be committed.");
  return { railwayOnPath, projectLinked, hasEnvExample: env.hasEnvExample, envGitignored: gi, notes };
}

// The exact railway command we WOULD run. (Never executed by the core.)
export function deployCommand({ detach = true } = {}) {
  return `railway up${detach ? " --detach" : ""}`;
}

// Top-level planner. `probe` carries side-effecting results gathered by the CLI (CLI presence,
// link status) so the core itself performs zero I/O beyond reading files in `dir`.
export function planDeploy(dir, opts = {}) {
  const { deploy = false, probe = {}, detach = true } = opts;
  const root = path.resolve(dir);
  const env = envDiff(root);
  return {
    dir: root,
    preflight: preflight(root, probe),
    envMissing: env.missing,
    secretFindings: secretHygieneScan(root),
    migrations: detectMigrations(root),
    command: deployCommand({ detach }),
    deploy, // intent only; execution is gated in the CLI and never happens in self-test
  };
}

// Is the plan safe to proceed with a real deploy? (No missing env, no preflight blockers.)
export function planIsDeployable(plan) {
  const p = plan.preflight;
  return p.railwayOnPath && p.projectLinked && p.hasEnvExample && plan.envMissing.length === 0;
}
