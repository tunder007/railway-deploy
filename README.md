# @softeneers/railway-deploy

> Deterministic, dry-run-by-default Railway deploys (backend + managed DB) with strict env-key diffing and a plaintext-secret scanner.

Zero runtime dependencies. Node ≥ 18. Part of the [Softeneers tools](https://github.com/tunder007/softeneers-tools) suite.

## Install

```bash
# one-off, no install
npx @softeneers/railway-deploy

# or install globally
npm i -g @softeneers/railway-deploy

# or as a dev dependency
npm i -D @softeneers/railway-deploy
```

## Usage

```bash
railway-deploy [path]   # plan; add --write to execute
```

## What it does

See [`functionalities/`](./functionalities/) for the full per-feature documentation, and
[`example-output/`](./example-output/) for sample reports.

## Part of a suite

Install every Softeneers tool at once with the wrapper:

```bash
npm i -g softeneers-tools
softeneers-tools run railway-deploy -- [args]
```

## License

MIT © 2026 Softeneers
