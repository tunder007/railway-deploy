# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-22

### Added

- Initial public release.
- Deterministic, dry-run-by-default Railway deploys (backend + managed DB) with strict env-key diffing and a plaintext-secret scanner.
- Zero runtime dependencies; requires Node >= 18.
- Hermetic self-test (`npm test`) and CI across Node 18, 20 and 22.

[1.0.0]: https://github.com/tunder007/railway-deploy/releases/tag/v1.0.0
