# Functionality 03 — Secret-hygiene scan (the highlight)

**Writes:** no (read-only) · **Idempotent:** yes · **Order:** after env-diff

## Purpose
Find **plaintext secrets committed where they shouldn't be** — DB passwords, tokens, and
credentialed connection strings in settings files, configs, or tracked `.env*` — and warn loudly,
**masking the value** and recommending rotation. This catches the exact class of mistake found in
this repo.

> **Real finding (carried from this session):** a live Railway DB password was committed in
> plaintext to `.claude/settings.local.json`. This scan flags that case by design.

## Inputs
- The directory to scan (the backend dir; can also be pointed at the repo root).

## Expected project structure
- Any. Scannable text files (`.json/.js/.cjs/.mjs/.ts/.env/.yml/.toml/.conf/.sh`, plus any
  `.env*` and `settings*.json`/`config.*`) are walked, skipping `node_modules`, `.git`, build dirs.

## How it works (deterministic)
1. Walk the tree (bounded, sorted) and read each scannable file.
2. Apply conservative patterns, each capturing the secret **value** in group 1:
   - `db-password` — `DB_PASSWORD` / `MYSQL_PASSWORD` / `POSTGRES_PASSWORD` / `PGPASSWORD`
   - `railway-token` — `RAILWAY_TOKEN` / `RAILWAY_API_TOKEN`
   - `generic-token` — `API_KEY` / `SECRET_KEY` / `ACCESS_TOKEN` / `AUTH_TOKEN` / `PRIVATE_KEY`
   - `connection-string` — `mysql|postgres|mongodb|redis|amqp://user:PASSWORD@host`
   Patterns tolerate JSON (`"KEY": "val"`) and dotenv (`KEY=val`) alike.
3. **Skip placeholders** — empty values, `${VAR}`, `<...>`, `your_*`, `changeme`, `xxx`, etc.
4. For every real hit, record `{ file, kind, masked, line }` — the value is **masked**
   (first 2 chars + a fixed-length `••••••••` tail; short values → `••••`). Sort deterministically.

## Output
`secretFindings: [ { file, kind, masked, line } ]` — values **always masked**.

## Safety
- **Never prints a secret value.** Masking is applied at capture time; the raw value never enters a
  finding, a plan, JSON output, or a log. The masked tail is a fixed length, so the real length
  isn't leaked either.
- Read-only.

## Failure modes it prevents
- Live credentials sitting in `settings.local.json` / configs (the actual repo finding).
- Tracked `.env` with real passwords.
- A connection string with embedded credentials slipping into the repo.
- A secret being printed by the very tool meant to protect it.
