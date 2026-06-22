# Railway deploy — skill specification (AI-optimized)

> **Source of truth for this skill.** This `.md` is written for AI agents (dense, machine-parseable).
> The human view is [`README.html`](./README.html), generated from this file. Per project
> convention: **`.md` = AI optimization, `.html` = human view.**

Deterministic deploy of a backend (+ managed DB) to **Railway** via the `railway` CLI, with strict
env handling and **secret hygiene**. One command produces a reviewable **plan** (preflight, env-key
diff, plaintext-secret scan, migrations, the exact deploy command); with `--deploy` it executes that
plan safely and verifies `/health`. Reference service: `lumen-code/backend` (Express + Sequelize +
MySQL on Railway), used read-only.

- **Task:** [`../05-skill-railway-deploy.md`](../05-skill-railway-deploy.md)
- **Status:** built (self-test passing)
- **Targets:** Claude Code · Codex · Cursor (one source of truth, three shells)

---

## 1. The problem it solves

The backend runs on Railway with MySQL; env wiring is fiddly and secret-sensitive. Deploys need to
be **repeatable** and to keep credentials **out of logs and out of git**. The real motivating
incident: a **live Railway DB password was committed in plaintext** to `.claude/settings.local.json`.
This skill makes deploys reproducible and actively **scans for that exact class of leak**, masking any
value it finds and recommending rotation.

---

## 2. What it does (functionalities)

A pipeline of **5 functionalities**, each documented under [`functionalities/`](./functionalities/)
on a uniform schema (Purpose · Inputs · Expected project structure · How it works · Output · Safety ·
Failure modes it prevents).

| # | Functionality | Writes? |
|---|---|---|
| 01 | [Preflight](./functionalities/01-preflight.md) | no (read-only) |
| 02 | [Env diff (keys only)](./functionalities/02-env-diff.md) | no (read-only) |
| 03 | [Secret-hygiene scan](./functionalities/03-secret-hygiene-scan.md) — **the highlight** | no (read-only) |
| 04 | [Plan & command](./functionalities/04-plan-and-command.md) | no (dry-run) |
| 05 | [Migrations & health verify](./functionalities/05-migrations-and-health-verify.md) | yes (gated by `--deploy`) |

01–04 are read-only and produce the plan; 05 runs only on a real deploy, behind the deployability
and secret gates.

---

## 3. Expected input

| Input | Required | Default | Notes |
|---|---|---|---|
| `<backend-dir>` | yes | `.` | The backend to deploy (e.g. `lumen-code/backend`). |
| `--deploy` | no | off (dry-run) | Required to actually deploy. Without it, prints the plan only. |
| `--no-detach` | no | off | Stream build logs (`railway up` without `--detach`) on a real deploy. |
| `--json` | no | off | Emit the machine-readable plan as JSON (always dry-run). |

**Invocation per agent**
- **Claude Code:** `/railway-deploy <backend-dir>` (Skill tool).
- **Codex:** read `AGENTS.md` "Deploying (Railway)" → run `scripts/deploy.mjs <backend-dir>`.
- **Cursor:** rule `railway-deploy.mdc` → same scripts.

**Default is read-only (dry-run).** Nothing is deployed unless `--deploy` is passed.

---

## 4. Expected structure of projects it works in

Targets an Express + Sequelize + MySQL backend on Railway (the `lumen-code/backend` pattern), but the
read-only checks run on any backend dir.

| Signal | Looks like | How it's used |
|---|---|---|
| Required env contract | `.env.example` with keys | diffed against `.env` + `process.env` (keys only) |
| Secret hygiene | `.gitignore`, `settings*.json`, configs, `.env*` | `.env*` ignored? · scanned for plaintext secrets |
| Migrations | `scripts.db:migrate` / `migrations/` | idempotent `railway run` command derived |
| Health | `GET /health` → `200 {"ok":true}` | post-deploy verification (real deploy only) |
| Railway config | `railway.json` (NIXPACKS, `npm run build`/`npm start`) | the build/start contract the deploy relies on |

---

## 5. Secret hygiene (the highlight)

- Scans scannable files for **DB passwords, tokens, and credentialed connection strings**, in JSON
  (`"KEY": "val"`) and dotenv (`KEY=val`) forms.
- **Skips placeholders** (empty, `${VAR}`, `<...>`, `your_*`, `changeme`, `xxx`…) to avoid noise.
- **Never prints a value** — every finding's value is **masked** (first 2 chars + a fixed-length
  `••••••••` tail), so neither the value nor its real length leaks.
- Reproduces the **real repo finding**: `.claude/settings.local.json` → `db-password`. Recommends
  **rotation** and confirms `.env*` is gitignored.
- A real deploy **refuses to proceed** while any secret is found.

---

## 6. Output

- **Dry-run (default):** a printed plan — preflight, env-diff, secret-hygiene scan (masked),
  migrations, and the exact `railway up --detach` command — then a "nothing executed" notice.
  `--json` emits the same plan as JSON. Sample: [`example-output/`](./example-output/).
- **`--deploy`:** runs `railway up`, idempotent migrations, then a `/health` 200 check; fails loudly
  on any non-200 or error.

Core shape (`planDeploy(dir, {})`):
```jsonc
{ "dir": "…/lumen-code/backend",
  "preflight": { "railwayOnPath": true, "projectLinked": false, "hasEnvExample": true,
                 "envGitignored": { "found": true, "ignored": true }, "notes": ["…"] },
  "envMissing": ["DB_HOST", "DB_PASSWORD", "…"],
  "secretFindings": [ { "file": ".claude/settings.local.json", "kind": "db-password",
                        "masked": "Hk••••••••", "line": 40 } ],
  "migrations": { "detected": true, "command": "railway run npm run db:migrate", "idempotentNote": "…" },
  "command": "railway up --detach",
  "deploy": false }
```

---

## 7. Safety & determinism guarantees

- **Dry-run by default.** No deploy without `--deploy`; the plan shows the exact command first.
- **Secret values never printed** — masked at capture; absent from plans, JSON, and logs.
- **Deploy gate.** `--deploy` refuses to run while preflight fails, env keys are missing, or any
  secret is found.
- **Idempotent migrations** (Sequelize `SequelizeMeta`); safe to re-run.
- **Deterministic.** No randomness, no clock in the core; sorted, stable output. Pure core in
  `scripts/lib/run.mjs`; the only side-effecting reads (CLI probes) live in the CLI.
- **Self-test is offline.** It never runs `railway up`/`railway run` or any mutating railway command,
  no network, no real secrets.

---

## 8. Acceptance criteria (from the task)

- [x] Preflight: `railway` on PATH; project linked/initialized; service reachable (read-only probes).
- [x] Required env keys diffed vs `.env.example`; missing → listed (and abort on real deploy).
- [x] **Secret hygiene:** no value ever printed; `.env*` gitignored confirmed; warn on committed
      secrets (the real `settings.local.json` finding) + recommend rotation.
- [x] Migrations idempotent (safe to re-run).
- [x] Post-deploy `/health` 200 check (real deploy only); fail loudly otherwise.

## 9. Build status & how to run

- ✅ This spec + 5 functionality docs + human `README.html`.
- ✅ **Implementation:** [`scripts/`](./scripts/) — zero-dependency Node.js. Pure core
  `lib/run.mjs` (`planDeploy` / `secretHygieneScan` / `envDiff` / `detectMigrations` /
  `planIsDeployable`), helpers `lib/util.mjs` (incl. `maskSecret`), thin CLI `deploy.mjs`
  (dry-run by default · `--deploy` · `--json`), `self-test.mjs`.
- ✅ **Cross-tool shells:** `.claude/skills/railway-deploy/SKILL.md` and
  `.cursor/rules/railway-deploy.mdc` — both wrap `deploy.mjs`.
- ✅ **Self-test:** `node scripts/self-test.mjs` builds a throwaway fixture in
  `/tmp/railway-deploy-selftest` and asserts env-diff lists missing keys, the secret scan FLAGS a
  planted secret and MASKS it (and is clean when none present), the command is correct, and dry-run
  executes nothing — with **no real railway calls**. **PASSED.**

```
node tasks/skill-railway-deploy/scripts/deploy.mjs lumen-code/backend            # plan (dry-run)
node tasks/skill-railway-deploy/scripts/deploy.mjs lumen-code/backend --json     # plan as JSON
node tasks/skill-railway-deploy/scripts/deploy.mjs lumen-code/backend --deploy   # real deploy (gated)
node tasks/skill-railway-deploy/scripts/self-test.mjs                            # offline gate
```

## References
- [`../05-skill-railway-deploy.md`](../05-skill-railway-deploy.md) — the task.
- `../../lumen-code/backend/` — the real Express+Sequelize+MySQL Railway service (read-only reference).
- `../skill-workspace-optimizer/`, `../skill-deterministic-checker/` — sibling skills (same conventions).
