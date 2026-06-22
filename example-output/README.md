# Example output

[`dry-run-plan.txt`](./dry-run-plan.txt) — a sample **dry-run** plan from
`node scripts/deploy.mjs lumen-code/backend`. It shows the four sections (preflight, env-diff,
secret-hygiene scan, migrations) and the exact `railway up --detach` command the tool *would* run.

The secret-hygiene section reproduces the **real finding** in this repo: a live Railway DB
password committed in plaintext to `.claude/settings.local.json`. The plan flags it and prints a
**masked** value (`Hk••••••••`) — the tool never emits the real secret, and the masked tail is a
fixed length so the value's true length isn't leaked either. The recommended action is to
**rotate** the credential and remove it from the file.

Dry-run is the default: nothing is executed or written. A real deploy requires `--deploy`, and the
tool refuses to proceed while preflight fails or required env keys are missing.
