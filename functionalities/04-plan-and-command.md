# Functionality 04 — Plan & command

**Writes:** no (dry-run) · **Idempotent:** yes · **Order:** assembles 01–03 + 05

## Purpose
Assemble the read-only checks into a single **plan** and print the **exact** `railway` command the
tool would run — so a human (or agent) can review precisely what a real deploy entails before
authorizing it. This is the default behavior: **plan only, execute nothing.**

## Inputs
- The backend dir; flags `--deploy` (intent only), `--no-detach`, `--json`.
- The CLI `probe` (railway-on-path, project-linked) from preflight.

## Expected project structure
- A backend dir with `package.json`; optional `.env.example`, `.gitignore`, `migrations/`.

## How it works (deterministic)
1. `planDeploy(dir, { deploy, probe, detach })` returns
   `{ dir, preflight, envMissing, secretFindings, migrations, command, deploy }`.
2. `command = "railway up" + (detach ? " --detach" : "")` — the exact command, never executed here.
3. The CLI prints the four sections + the command, then exits with the dry-run notice.
4. `--json` emits the whole plan object (still dry-run) for programmatic use. The plan never
   contains a secret value (findings are pre-masked).

## Output
- Human-readable plan (default) or JSON (`--json`). `deploy:false` until `--deploy` is passed.

## Safety
- **Dry-run by default.** `--deploy` only flips the *intent*; actual execution is gated separately
  (functionality 05) behind preflight + env + secret checks.
- `planIsDeployable(plan)` is the single gate: true only when CLI present, project linked,
  `.env.example` present, and `envMissing` empty.

## Failure modes it prevents
- Surprise deploys (you always see the command first).
- Authorizing a deploy without seeing the secret/env/preflight state.
- A plan that leaks secrets (values are masked before they reach the plan).
