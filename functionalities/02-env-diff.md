# Functionality 02 — Env diff (keys only)

**Writes:** no (read-only) · **Idempotent:** yes · **Order:** after preflight

## Purpose
Determine whether every environment variable the app *requires* is configured, by diffing the
declared contract (`.env.example`) against what's available locally — **without ever reading a
value**. Missing keys abort a real deploy.

## Inputs
- `.env.example` — the declared required keys (the contract).
- `.env` (optional) and `process.env` — the locally-known keys (union).

## Expected project structure
- `.env.example` at the backend root listing required keys (e.g. `DB_HOST=`, `DB_PASSWORD=`).

## How it works (deterministic)
1. Parse `.env.example` into an ordered list of **keys** (tolerates `export KEY=`, comments, blanks).
2. Build the set of known keys = keys in `.env` ∪ keys in `process.env`.
3. `missing = required − known`, sorted.

## Output
`{ hasEnvExample, required:[...], missing:[...] }` — and `envMissing` on the top-level plan.

## Safety
- **Keys only.** The parser returns key names; values are never returned upstream, so a missing
  or present value can never leak into a plan or log.
- On a real deploy, a non-empty `missing` list **aborts** (the deploy gate refuses).

## Failure modes it prevents
- Deploying a service that boots without its DB credentials and then 500s at runtime.
- Drift between `.env.example` (the contract) and what's actually set.
- Accidentally echoing secret values while "checking the env" (we only ever touch keys).
