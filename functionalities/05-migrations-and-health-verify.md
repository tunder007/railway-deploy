# Functionality 05 — Migrations & health verify

**Writes:** yes (gated by `--deploy`) · **Idempotent:** yes (migrations safe to re-run) · **Order:** runs last, only on real deploy

## Purpose
On a real deploy, run database migrations **idempotently** and then **verify** the service is
actually up via its `/health` endpoint — so "deployed" means "verified healthy," not just "command
exited 0." None of this runs in dry-run or in the self-test.

## Inputs
- A deployable plan (passes `planIsDeployable` and has no secret findings).
- `package.json` `scripts.db:migrate` and/or a `migrations/` dir (Sequelize-style).

## Expected project structure
- Express + Sequelize + MySQL backend (the `lumen-code/backend` pattern): a `db:migrate` script and
  a `GET /health` route returning `200 {"ok":true}`.

## How it works (deterministic, real deploy only)
1. **Re-gate:** refuse if preflight failed, env keys are missing, or any secret was found.
2. `railway up [--detach]` (the exact command from functionality 04).
3. **Migrations (idempotent):** `railway run npm run db:migrate` (or
   `railway run npx sequelize-cli db:migrate`). Sequelize records applied migrations in
   `SequelizeMeta`, so re-running skips already-applied ones — safe to re-run.
4. **Health verify:** resolve the service domain (`railway domain`) and `GET <url>/health`;
   require **200**, else fail loudly with a non-zero exit.

## Output
- A deployed service + a verified `/health` (on real deploy). In dry-run, only the documented
  commands and the health-check description are printed.

## Safety
- **Gated:** every step here is behind `--deploy` and the deployability/secret gates.
- **The self-test NEVER reaches this path** — it only exercises the pure planning/scan core with
  `deploy:false` and no railway calls. No `railway up` / `railway run` is ever executed in tests.
- Migrations are idempotent; the health check fails loudly rather than reporting false success.

## Failure modes it prevents
- "Deployed" but the service is down (health check catches it).
- Re-running migrations corrupting state (idempotent by construction).
- Deploying despite missing env or committed secrets (re-gated immediately before `railway up`).
