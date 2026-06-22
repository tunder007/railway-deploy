#!/usr/bin/env node
// Railway deploy — CLI. Plans (and optionally executes) a deterministic Railway deploy.
// Usage: node deploy.mjs <backend-dir> [--deploy] [--no-detach] [--json]
//   default            = DRY-RUN: print the plan + the exact command, write/run NOTHING.
//   --deploy           = real deploy: runs preflight, then `railway up`, then /health check.
//   --no-detach        = stream build logs (omit --detach) on real deploy.
//   --json             = emit the machine-readable plan as JSON (always dry-run).
//
// SECRET HYGIENE: this tool NEVER prints a secret value. Findings show masked values only.
import { spawnSync } from "node:child_process";
import { fs, path } from "./lib/util.mjs";
import { planDeploy, planIsDeployable, deployCommand } from "./lib/run.mjs";

function parseArgs(argv) {
  const a = { dir: ".", deploy: false, detach: true, json: false };
  for (const t of argv.slice(2)) {
    if (t === "--deploy") a.deploy = true;
    else if (t === "--no-detach") a.detach = false;
    else if (t === "--json") a.json = true;
    else if (!t.startsWith("--")) a.dir = t;
  }
  return a;
}

// --- read-only CLI probes (the only side-effecting reads; kept out of the pure core) ----------
function probeRailway() {
  // Read-only: `railway --version` and `railway status`. Tolerate absence (CLI not installed).
  let railwayOnPath = false, projectLinked = false;
  try {
    const v = spawnSync("railway", ["--version"], { encoding: "utf8", timeout: 8000 });
    railwayOnPath = v.status === 0;
  } catch { railwayOnPath = false; }
  if (railwayOnPath) {
    try {
      const s = spawnSync("railway", ["status"], { encoding: "utf8", timeout: 8000 });
      // `railway status` exits 0 and prints the project when linked; non-zero / "No linked project" otherwise.
      projectLinked = s.status === 0 && !/no linked project/i.test((s.stdout || "") + (s.stderr || ""));
    } catch { projectLinked = false; }
  }
  return { railwayOnPath, projectLinked };
}

function printPlan(plan) {
  const sev = plan.secretFindings.length ? "⚠" : "✓";
  console.log(`\nRailway deploy — plan for ${plan.dir}`);
  console.log(`mode: ${plan.deploy ? "DEPLOY (real)" : "DRY-RUN (read-only)"}\n`);

  console.log("Preflight");
  console.log(`  ${plan.preflight.railwayOnPath ? "✓" : "✗"} railway CLI on PATH`);
  console.log(`  ${plan.preflight.projectLinked ? "✓" : "✗"} project linked`);
  console.log(`  ${plan.preflight.hasEnvExample ? "✓" : "✗"} .env.example present`);
  const gi = plan.preflight.envGitignored;
  console.log(`  ${gi.found && gi.ignored ? "✓" : "✗"} .env* gitignored`);
  for (const n of plan.preflight.notes) console.log(`    · ${n}`);

  console.log("\nEnv diff (keys only — values never read)");
  if (!plan.preflight.hasEnvExample) console.log("  · no .env.example to diff against");
  else if (plan.envMissing.length === 0) console.log("  ✓ all required keys configured");
  else console.log(`  ✗ missing ${plan.envMissing.length} key(s): ${plan.envMissing.join(", ")}`);

  console.log(`\nSecret-hygiene scan  ${sev}`);
  if (plan.secretFindings.length === 0) console.log("  ✓ no plaintext secrets found in scanned files");
  else {
    console.log(`  ⚠ ${plan.secretFindings.length} plaintext secret(s) found (values masked):`);
    for (const f of plan.secretFindings) console.log(`    ${f.file}:${f.line}  [${f.kind}]  value=${f.masked}`);
    console.log("  → ROTATE these credentials and ensure the file is not committed (gitignore .env*; do not commit settings.local.json secrets).");
  }

  console.log("\nMigrations");
  if (!plan.migrations.detected) console.log("  · none detected");
  else { console.log(`  command (idempotent): ${plan.migrations.command}`); console.log(`  · ${plan.migrations.idempotentNote}`); }

  console.log(`\nDeploy command it WOULD run:\n  ${plan.command}`);
  console.log(`Post-deploy check: GET <service-url>/health expects 200 {"ok":true}`);
}

// Real-deploy path (only reached with --deploy). The self-test never calls this.
function runRealDeploy(plan, args) {
  if (!planIsDeployable(plan)) {
    console.error("\n✗ Refusing to deploy: preflight failed or required env keys are missing. Fix the items above first.\n");
    process.exit(1);
  }
  if (plan.secretFindings.length) {
    console.error("\n✗ Refusing to deploy: plaintext secrets detected. Rotate + remove them, then re-run.\n");
    process.exit(1);
  }
  const cmd = deployCommand({ detach: args.detach });
  console.log(`\n→ Executing: ${cmd}`);
  const parts = cmd.split(" ");
  const up = spawnSync(parts[0], parts.slice(1), { cwd: plan.dir, stdio: "inherit", timeout: 600000 });
  if (up.status !== 0) { console.error("\n✗ railway up failed.\n"); process.exit(up.status || 1); }

  if (plan.migrations.detected) {
    console.log(`\n→ Migrations: ${plan.migrations.command}`);
    const mparts = plan.migrations.command.split(" ");
    const mig = spawnSync(mparts[0], mparts.slice(1), { cwd: plan.dir, stdio: "inherit", timeout: 600000 });
    if (mig.status !== 0) { console.error("\n✗ migrations failed.\n"); process.exit(mig.status || 1); }
  }

  // Post-deploy /health check against the deployed domain.
  const dom = spawnSync("railway", ["domain"], { cwd: plan.dir, encoding: "utf8", timeout: 8000 });
  const url = (dom.stdout || "").trim().split(/\s+/).find((t) => /^https?:\/\//.test(t));
  if (!url) { console.warn("\n⚠ Could not resolve service domain for /health check. Verify manually.\n"); return; }
  healthCheck(`${url.replace(/\/$/, "")}/health`);
}

async function healthCheck(healthUrl) {
  console.log(`\n→ Health check: GET ${healthUrl}`);
  try {
    const res = await fetch(healthUrl, { method: "GET" });
    if (res.status === 200) console.log(`✓ /health returned 200. Deploy verified.\n`);
    else { console.error(`✗ /health returned ${res.status}; deploy NOT verified.\n`); process.exit(1); }
  } catch (e) { console.error(`✗ /health request failed: ${e.message}\n`); process.exit(1); }
}

async function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(args.dir);
  if (!fs.existsSync(root)) { console.error(`Backend dir not found: ${root}`); process.exit(2); }

  const probe = probeRailway();
  const plan = planDeploy(root, { deploy: args.deploy, probe, detach: args.detach });

  if (args.json) { console.log(JSON.stringify(plan, null, 2)); return; }

  printPlan(plan);

  if (!args.deploy) {
    console.log(`\n(dry-run — nothing executed. Re-run with --deploy to deploy for real.)\n`);
    return;
  }
  await runRealDeploy(plan, args);
}

main();
