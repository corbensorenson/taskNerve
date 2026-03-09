# Git Complaints + TaskNerve v1 Speed Plan (2026-03-09)

## Why this exists

This note captures externally reported Git pain points and maps them to tasknerve v1 features and backlog. The goal is to remove common Git friction while keeping tasknerve tiny by default and fast on demand.

## Source-backed pain points

1. Git usability and conceptual load are hard for many users, especially around branching/merge workflows.
- Source: arXiv, *Git Takes Two: Merge Conflicts and Their Resolution in Collaborative Coding* (2024) [https://arxiv.org/abs/2410.19914](https://arxiv.org/abs/2410.19914)
- Source: Stack Overflow discussion on Git complexity/pros-cons [https://stackoverflow.com/questions/2047465/git-pros-and-cons](https://stackoverflow.com/questions/2047465/git-pros-and-cons)

2. Stash/pull/pop loops are a recurring workflow complaint when local changes block pull.
- Source: Stack Overflow local-change overwrite pull error thread [https://stackoverflow.com/questions/14318234/how-do-i-ignore-an-error-on-git-pull-about-my-local-changes-would-be-overwritt](https://stackoverflow.com/questions/14318234/how-do-i-ignore-an-error-on-git-pull-about-my-local-changes-would-be-overwritt)
- Source: `git-stash` docs explicitly describe stashing to run pull [https://git-scm.com/docs/git-stash](https://git-scm.com/docs/git-stash)

3. Merge conflict repetition is painful and repetitive.
- Source: Pro Git `rerere` (reuse recorded resolution) [https://git-scm.com/book/en/v2/Git-Tools-Rerere](https://git-scm.com/book/en/v2/Git-Tools-Rerere)

4. Large-repo performance is a major speed complaint.
- Source: `git update-index` docs: split index, untracked cache, fsmonitor [https://git-scm.com/docs/git-update-index](https://git-scm.com/docs/git-update-index)
- Source: GitHub sparse-checkout/sparse-index article [https://github.blog/open-source/git/bring-your-monorepo-down-to-size-with-sparse-checkout/](https://github.blog/open-source/git/bring-your-monorepo-down-to-size-with-sparse-checkout/)
- Source: `git clone` docs for partial clone/filter [https://git-scm.com/docs/git-clone](https://git-scm.com/docs/git-clone)
- Source: `git maintenance` docs [https://git-scm.com/docs/git-maintenance](https://git-scm.com/docs/git-maintenance)

5. Auth/credential setup remains annoying and error-prone in day-to-day use.
- Source: Git credential protocol docs/usage via CLI (`git credential`, `git config credential.helper`) in official Git docs [https://git-scm.com/docs/gitcredentials](https://git-scm.com/docs/gitcredentials)

## v1 features implemented against those complaints

1. Auth wrapping in tasknerve bridge.
- Added `tasknerve bridge auth status|login|logout` using Git credential protocol.
- Added HTTPS credential preflight in `bridge sync-github`.

2. Pull-with-local-changes quality-of-life.
- Added `tasknerve bridge pull-github --autostash` to encapsulate stash/pull/pop.

3. Tiny-by-default local performance with burst mode.
- Local scan/object work defaults to `1` worker (low idle footprint).
- Added `--burst` and `--hash-jobs` for `status` and `checkpoint`.
- Added `--object-jobs` for checkpoint object storage.

4. Burst push for short high-compute windows.
- Added `bridge sync-github --burst-push` and `--pack-threads`.
- Applies temporary Git `pack.threads` override during push.

## Next high-ROI v1 additions

1. `tasknerve bridge optimize-git --profile tiny|balanced|burst`
- Apply vetted repo-local Git config bundles:
  - `core.untrackedCache=true`
  - `core.splitIndex=true`
  - optional `core.fsmonitor=true` where supported
  - `rerere.enabled=true`
  - `fetch.parallel`/`pack.threads` profile tuning

2. `tasknerve bridge clone-github --filter blob:none --sparse`
- Use partial clone + sparse checkout for giant repos.

3. Conflict-reuse defaults for teams
- One-shot command to enable `rerere` and safe pull strategy defaults.

4. Background maintenance controls
- Manual and scheduled maintenance entrypoints that remain off by default in tiny profile.

## v1 operating rule

- Default profile: tiny footprint.
- Burst profile: explicit, short-lived, user/agent opt-in.
- No always-on heavy daemons unless explicitly enabled.
