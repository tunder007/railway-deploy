#!/usr/bin/env node
// Self-test for the Railway deploy skill. OFFLINE & DETERMINISTIC.
// Builds a throwaway FIXTURE backend in a unique temp dir, then asserts:
//   · env-diff lists the missing required keys
//   · secret scan FLAGS a planted fake secret AND masks its value (never prints it)
//   · secret scan is CLEAN when no secrets are present
//   · plan/command are correct; dry-run executes NOTHING
//   · a real-secret value never leaks into the plan output
// CRITICAL: this never runs `railway up`/`railway run`/any mutating railway command, no network.
import os from "node:os";
import { fs, path, readText } from "./lib/util.mjs";
import {
  planDeploy, scanText, secretHygieneScan, envDiff, envIsGitignored,
  detectMigrations, deployCommand, planIsDeployable,
} from "./lib/run.mjs";

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`); if (!cond) failures++; };

// --- unique temp fixture (per task spec) ---
const fixture = path.join(os.tmpdir(), "railway-deploy-selftest");
fs.rmSync(fixture, { recursive: true, force: true });
const write = (rel, content) => { const abs = path.join(fixture, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, content); };

// A backend fixture: .env.example (keys), a settings file with a PLANTED FAKE secret, .gitignore,
// a package.json with a db:migrate script, and a migrations dir.
const PLANTED = "hunter2"; // fake secret value — must NEVER appear in any output
write(".env.example", "PORT=4000\nDB_HOST=127.0.0.1\nDB_NAME=lumen_dev\nDB_USER=root\nDB_PASSWORD=\nRAILWAY_TOKEN=\n");
write(".claude/settings.local.json", JSON.stringify({ env: { DB_PASSWORD: PLANTED }, note: "fake" }, null, 2) + "\n");
write(".gitignore", "node_modules/\ndist/\n.env\n.env.local\n");
write("package.json", JSON.stringify({ name: "fixture-backend", scripts: { "db:migrate": "sequelize-cli db:migrate" } }, null, 2) + "\n");
write("migrations/20240101-init.cjs", "module.exports = { up(){}, down(){} };\n");

console.log(`\nRailway deploy — self-test`);
console.log(`fixture: ${fixture}\n`);

// --- env diff (offline; clear inherited env keys so the fixture controls the result) ---
console.log("Env diff");
const saved = {};
for (const k of ["PORT", "DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD", "RAILWAY_TOKEN"]) { saved[k] = process.env[k]; delete process.env[k]; }
const ed = envDiff(fixture);
ok(ed.hasEnvExample, ".env.example detected");
ok(ed.missing.includes("DB_PASSWORD") && ed.missing.includes("RAILWAY_TOKEN"), `missing keys listed (${ed.missing.join(", ")})`);

// --- secret scan: FLAGS planted secret + masks value ---
console.log("Secret-hygiene scan (planted secret)");
const findings = secretHygieneScan(fixture);
const planted = findings.find((f) => f.file.includes("settings.local.json") && f.kind === "db-password");
ok(!!planted, "planted DB_PASSWORD in settings.local.json is FLAGGED");
ok(planted && !planted.masked.includes(PLANTED), `value is masked in the finding (masked=${planted ? planted.masked : "n/a"})`);
ok(JSON.stringify(findings).indexOf(PLANTED) === -1, "raw secret value never appears anywhere in the findings");

// --- secret scan: CLEAN when no secrets ---
console.log("Secret-hygiene scan (clean tree)");
const cleanText = scanText("config.json", JSON.stringify({ DB_PASSWORD: "", API_KEY: "${SECRET}", note: "placeholder" }));
ok(cleanText.length === 0, "empty/placeholder values are NOT flagged");

// --- connection-string detection ---
console.log("Connection-string detection");
const cs = scanText(".env.prod", "DATABASE_URL=mysql://root:" + PLANTED + "@db.railway.app:3306/lumen\n");
ok(cs.length === 1 && cs[0].kind === "connection-string", "credentialed connection string is flagged");
ok(cs[0] && !cs[0].masked.includes(PLANTED), "connection-string password is masked");

// --- gitignore + migrations + command ---
console.log("Preflight bits");
ok(envIsGitignored(fixture).ignored, ".env is detected as gitignored");
const mig = detectMigrations(fixture);
ok(mig.detected && /db:migrate/.test(mig.command), `idempotent migration command derived (${mig.command})`);
ok(deployCommand() === "railway up --detach", "deploy command is `railway up --detach`");
ok(deployCommand({ detach: false }) === "railway up", "non-detached command is `railway up`");

// --- full plan: offline, executes nothing, no secret leak ---
console.log("Plan (dry-run, offline)");
const plan = planDeploy(fixture, { deploy: false, probe: { railwayOnPath: false, projectLinked: false } });
ok(plan.deploy === false, "plan defaults to dry-run (deploy=false)");
ok(plan.command === "railway up --detach", "plan carries the exact deploy command");
ok(plan.secretFindings.length >= 1, "plan surfaces the secret finding");
ok(JSON.stringify(plan).indexOf(PLANTED) === -1, "raw secret value never appears anywhere in the plan");
ok(plan.envMissing.includes("DB_PASSWORD"), "plan lists missing env keys");
ok(planIsDeployable(plan) === false, "plan is NOT deployable while preflight fails (gate holds)");

// restore env
for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }

// --- cleanup ---
fs.rmSync(fixture, { recursive: true, force: true });

console.log(failures ? `\nSELF-TEST FAILED (${failures} assertion${failures > 1 ? "s" : ""})\n` : `\nSELF-TEST PASSED\n`);
process.exit(failures ? 1 : 0);
