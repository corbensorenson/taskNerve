# Security Policy

## Reporting a Vulnerability

Please report vulnerabilities privately by opening a private security advisory in the repository hosting platform or contacting the maintainers through a private channel.

Do not open public issues for undisclosed vulnerabilities.

## Scope

This project handles:
- local timeline metadata,
- Git bridge credentials via system git credential helpers,
- advisor runtime state and provider outputs under `.fugit/`,
- optional installer-time PATH modification.

Security-sensitive changes should include:
- threat model notes,
- regression tests where applicable,
- explicit migration/rollback guidance.

## Credential Hygiene

- Keep `.fugit/` ignored; it can contain runtime advisor outputs, generated plans, and worker metadata.
- Do not commit API keys, provider tokens, or copied credential material into tracked files.
- Prefer secure Git credential helpers (`manager-core`, `osxkeychain`, `libsecret`, `wincred`) over plaintext storage.
