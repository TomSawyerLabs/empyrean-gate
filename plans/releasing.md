# Cutting a release

## Goal

A repeatable, correct release of Empyrean Gate. Written after v0.9.0, where the
mechanical part (bump four files, tag, push) was the easy half and reconciling a
remote that kept moving was the rest of it.

## The rule that is not negotiable

**Nothing is ever published from this machine.** No `tauri build` upload, no
`gh release create`, no attaching artifacts by hand. The GitHub Release is
created by `.github/workflows/release.yml` and by nothing else, so every binary
comes from a clean checkout of a known tag with the full check suite in front of
it. If the release path is broken, fix the workflow — do not route around it.

The only thing this machine does is **push a version tag**.

## Environment / context

- Remote: `git@github.com:cinderblock/empyrean-gate.git`, branch `master`.
- Trigger: `on: push: tags: ["v*"]` in `.github/workflows/release.yml`.
- Tags are **annotated** (`git tag -a`), matching v0.6.0 through v0.9.0.
- The version lives in **four** files and they must agree:
  - `package.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/Cargo.lock` (let `cargo metadata` rewrite it, don't hand-edit)
  - `src-tauri/tauri.conf.json`
- The version-bump commit's message is bare: `v0.9.0`. No body.
- What CI gates a release on, in order: `bun install --frozen-lockfile`,
  `bun run typecheck`, `bun run test:layout`, `bun run test:behavior`,
  `bun tauri build --no-bundle`, `cargo test --release --lib`,
  `cargo test --release --bin engine-smoke`, plus the Linux AppImage build.
  Three platforms; a run takes roughly 20–25 minutes.
- Linux ships **two** assets (bare binary + AppImage) because the bare one needs
  `libwebkit2gtk` already installed. The workflow deliberately has no `|| true`
  on the AppImage step: a release that silently drops an asset is worse than a
  failed one, and the updater looks assets up by exact name.

## Steps

1. **Reconcile with the remote first.** Other sessions push to `master`
   constantly; assume you are both ahead and behind.
   ```
   git fetch origin
   git rev-list --count origin/master..HEAD   # ahead
   git rev-list --count HEAD..origin/master   # behind
   ```
2. **Probe before you rewrite anything.** Both of these are read-only:
   ```
   git merge-tree --write-tree HEAD origin/master     # exit 0 = clean merge
   git worktree add --detach /tmp/probe HEAD && cd /tmp/probe \
     && git checkout -b probe/rebase && git rebase origin/master
   ```
   Then `git worktree remove --force /tmp/probe && git branch -D probe/rebase`.
3. **Rebase** (`git rebase origin/master`). Local commits are unpushed, the repo
   history is linear, and the push that follows is a fast-forward — so this needs
   no force and must never become one. Take a `git stash store` snapshot first.
4. **Run the check suite locally** at the rebased tip, so a 25-minute CI run does
   not fail on something `tsc` would have caught in four seconds:
   ```
   bun install --frozen-lockfile && bun run typecheck
   cargo test --manifest-path src-tauri/Cargo.toml --lib
   cargo test --manifest-path src-tauri/Cargo.toml --bin engine-smoke
   bun run build && npx playwright test
   ```
   Wrap the heavy ones in `node ~/.claude/bin/cpu-slots.mjs run --slots N -- …`
   (see the `compute-budget` skill) — this machine is shared.
5. **Bump the four files**, `cargo metadata --manifest-path src-tauri/Cargo.toml`
   to refresh the lock, and commit as `vX.Y.Z`.
6. **Re-fetch.** If origin moved while you were testing, rebase again and re-run
   step 4. On v0.9.0 this happened twice.
7. **Push the branch, then the tag:**
   ```
   git push origin master
   git tag -a vX.Y.Z -m "Empyrean Gate vX.Y.Z"
   git push origin vX.Y.Z
   ```
8. **Watch the run** — `gh run list --workflow=release.yml --limit 3`. A release
   nobody watched is a release that failed quietly.

## Build time and the cache

A release run is gated by its **slowest** platform. The three build jobs start at
the same second — GitHub runs them fully in parallel, there is no queue to jump —
so "how long is a release" is "how long is Windows".

| | v0.7.2 | v0.8.0 | v0.9.0 |
|---|---|---|---|
| macOS | 14m | 16m | 15m |
| Linux | 13m | 19m | 19m |
| **Windows** | **18m** | **23m** | **23m** |

Windows' 23 minutes is 14.5m `tauri build`, 4.2m `cargo test --release --lib`,
2.8m `cargo test --release --bin engine-smoke`. The growth since v0.7.2 is spread
evenly across all three — it is code volume, not a regression. Linux's jump at
v0.8.0 is the AppImage step arriving.

**Until this was fixed, every release compiled the whole dependency tree cold**,
on all three platforms, and logged `No cache found` every time. Two independent
causes:

1. **Cache refs.** GitHub scopes a cache to the ref that wrote it, and a run may
   read only its own ref's caches or the **default branch's**. Releases run on
   `refs/tags/vX.Y.Z`, so each release could only ever read a cache written by
   that same tag. v0.9.0 rebuilt a byte-identical copy of a 949 MB entry sitting
   under `refs/tags/v0.8.0` — same key, `v0-rust-build-Windows_NT-x64-368f6b88-39f930fc`
   — that it was not permitted to open.
2. **Wrong profile, wrong key.** The master caches a tag *may* read came from
   checks.yml's `cargo test --lib`, which is **debug**; a `target/debug` cache
   does nothing for a release build. And rust-cache puts the job id in the key by
   default, so `rust` (checks.yml) never matched `build` (release.yml) anyway.

The fix is `.github/workflows/warm-cache.yml`: build the release profile **on
master**, save under `shared-key: release-build`, and have release.yml restore
that same key with `save-if: false`. Read its header before changing any of it.

Two things to know about it:

- What is cached is the dependency tree, not this crate — rust-cache prunes the
  workspace's own artifacts before saving. Dependencies change only when
  `Cargo.lock` does, which is why a nightly warm is enough even though master
  moves many times a day; a lockfile push also triggers a re-warm immediately.
- **A dependency bump means the next release is cold again.** That is one slow
  release, not a broken one.

### Cache quota

The 10 GB repo quota was at 9.37 GB, 6.34 GB of it tag-scoped entries no run
could ever read (v0.8.0, v0.9.0, and a deleted branch). Past 10 GB GitHub evicts
least-recently-used, so the dead entries were actively pushing out live ones.
`save-if: false` stops manufacturing ~2.8 GB per release. To audit:

```
gh cache list --limit 100 --json id,key,ref,sizeInBytes --jq '.[] | [.id, .sizeInBytes, .ref, .key] | @tsv'
```

Anything under `refs/heads/refs/tags/...` or a deleted branch is dead; delete it.

### What was considered and rejected

- **Larger GitHub runners.** Billed even on public repos: Windows 8-core
  $0.042/min, 16-core $0.082/min. At the observed cadence — 19 releases in 5 days
  — that is roughly $71–98/month, and a spending cap would then start *failing
  releases*, which is worse than a slow one. Note `windows_4_core` buys nothing:
  standard `windows-latest` is already 4-core.
- **A self-hosted runner.** Tempting (a persistent `target/` skips the cache
  problem entirely) but this repo is **public**, and a self-hosted runner on a
  public repo lets a fork's pull request run code on that machine. Only worth it
  with the self-hosted label restricted to tag/master-push jobs so `pull_request`
  can never reach it — and it is a server change, so it goes through the `ops`
  repo with per-change approval.
- **Cross-compiling Windows from Linux.** `--no-bundle` removes the usual Tauri
  blocker and `cargo-xwin` would probably link, but it produces a Windows binary
  that has never *run* on Windows and drops the Windows test job. checks.yml
  already carries the note about why that matters: a Linux-only green run shipped
  the CRLF bug in v0.5.0.

## Findings / gotchas

- `origin/master` moved **twice** during the v0.9.0 cut, from parallel sessions.
  Budget for re-fetching right before the push, and treat "ahead: N behind: 0" as
  the only state from which to push.
- A clean `git merge-tree` does **not** imply a clean rebase — the merge collapses
  all commits at once, a rebase replays each against the new base. Probe the one
  you intend to run.
- `gh run view <id> --json status,conclusion,jobs` is the shape to poll; the three
  matrix jobs finish at very different times (macOS is usually last).

## Things not to do

- Don't publish, upload, or attach an artifact from a CLI. Ever. See above.
- Don't force-push to recover from a diverged `master`. Rebase local (unpushed)
  work onto origin and fast-forward, or push a new branch. There is a
  `PreToolUse` hook that blocks force pushes; being blocked is the system working.
- Don't hand-edit `Cargo.lock`'s version. Let cargo write it, or the lock and the
  manifest can drift in ways `--frozen-lockfile` will fail on in CI.
- Don't tag a commit you have not run the check suite on. The tag is immutable in
  practice once anyone has fetched it.
- Don't add `save-if: true` (or drop `save-if: false`) to release.yml's
  rust-cache. A cache written on a tag ref is readable by nothing afterwards; it
  only burns quota and evicts the entries that do work.
- Don't rebase `master` to reconcile when the commits ahead are someone else's
  in-flight work. On the cache change, local master held a peer's unpushed commit
  that conflicted with origin; the right move was `git rebase --abort` and a
  separate worktree off `origin/master`, not resolving a conflict in a commit
  whose intent wasn't mine to guess.
- Don't cut a release without reading what is actually in it. v0.9.0 shipped four
  games, a macOS renderer change, and patch-routing work from parallel sessions —
  all correct, none of it mine, and worth telling the user about *before* the tag
  rather than after.
