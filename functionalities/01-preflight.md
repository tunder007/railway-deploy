# Functionality 01 — Preflight

**Writes:** no (read-only) · **Idempotent:** yes · **Order:** runs first

## Purpose
Confirm the environment is safe and ready to deploy *before* anything happens — so a real deploy
never starts from a broken or unsafe state. Cheap, read-only checks that fail loudly and early.

## Inputs
- Backend dir.
- CLI probes gathered by `deploy.mjs` (read-only): is `railway` on PATH (`railway --version`), is a
  project linked (`railway status`). These are passed into the pure core as `probe` so the core
  itself stays side-effect-free and testable.

## Expected project structure
- A backend dir with `package.json` and ideally a `.env.example` and `.gitignore`.

## How it works (deterministic)
1. `railway --version` (read-only) → `railwayOnPath`.
2. `railway status` (read-only) → `projectLinked` (false if "No linked project").
3. Check `.env.example` exists (drives the env-diff in functionality 02).
4. Check `.gitignore` ignores `.env*` (drives secret hygiene in functionality 03).
5. Collect human-readable `notes[]` for every blocker found.

## Output
`preflight: { railwayOnPath, projectLinked, hasEnvExample, envGitignored:{found,ignored}, notes:[] }`

## Safety
- Read-only. The only railway commands invoked are `--version` and `status` (non-mutating).
- Absence of the CLI is tolerated (reported as a note), never a crash. The self-test runs with
  `railwayOnPath:false` and performs no railway calls at all.

## Failure modes it prevents
- Starting a deploy with no linked project (would deploy to the wrong place or error mid-way).
- Deploying with `.env*` un-ignored (the route by which secrets get committed).
- Silent failure when the CLI isn't installed.
