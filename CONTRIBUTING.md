# Contributing to tasknerve

Thanks for contributing.

## Development Setup

1. Install Rust stable.
2. Run checks:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

3. For installer validation:

```bash
bash ./install.sh --install-dir "$(mktemp -d)" --skip-rust-install
```

## Contribution Rules

- Keep changes project-agnostic.
- Do not add personal identifiers or machine-specific absolute paths.
- Keep default runtime profile tiny-footprint; burst behavior must be explicit/opt-in.
- Preserve deterministic timeline behavior.

## Pull Requests

- Use focused PRs.
- Add/adjust tests for behavior changes.
- Update README/skill docs for user-facing changes.
- Upstream acceptance and release scope are maintainer-governed; see `GOVERNANCE.md`.
