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
- Don't cut a release without reading what is actually in it. v0.9.0 shipped four
  games, a macOS renderer change, and patch-routing work from parallel sessions —
  all correct, none of it mine, and worth telling the user about *before* the tag
  rather than after.
