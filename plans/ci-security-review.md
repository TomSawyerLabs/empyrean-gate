# CI / release-channel security review

**Status:** review complete (2026-09-17). No changes made — findings only.

## Goal

Answer two questions about the release pipeline:

1. Who is allowed to push a version tag (and thereby ship a release)?
2. Could a random member of the public push a malicious version that gets built
   and automatically installed on the rig?

The stakes are higher than a normal library repo because the app **self-updates
from GitHub Releases** (`src-tauri/src/updater.rs`) and then **promotes itself
over the launcher path** and re-points launch-at-login. A bad release is
persistent code execution on the show machine.

## Environment / context

- Repo: `TomSawyerLabs/empyrean-gate`, **public**, default branch `master`.
- Release trigger: `.github/workflows/release.yml`, `on: push: tags: ["v*"]`.
- Updater polls `https://api.github.com/repos/TomSawyerLabs/empyrean-gate/releases/latest`
  every 6 h and at startup.
- `auto_check: true`, **`auto_install: false`** by default (`src-tauri/src/config.rs:729`).
- Repo secret: `BLACKSMITH_ORG_TOKEN`. Repo variable: `SHOW_MODE`.

### Access as of 2026-09-17

| Account | Role | Can push a `v*` tag? |
|---|---|---|
| `cinderblock` | admin (sole org owner) | yes |
| `waterbury` | write | yes |
| `ericvicenti` | write | yes |
| `allibell` | write | yes |
| `BlakeTacklind` | read | no |

Org members: `cinderblock`, `BlakeTacklind`. No teams on the repo.

## Answers

**Q2 first, because it is the reassuring one: no.** There is no path from an
outside account to a release. Tag creation requires write access. Fork PRs
cannot create tags; `checks.yml` uses a plain `pull_request:` trigger (not
`pull_request_target`), so fork runs get a read-only `GITHUB_TOKEN` and **no**
secrets; fork-PR approval policy is `first_time_contributors`.

**Q1: the four write-access accounts above, with nothing standing in the way.**
No rulesets, no tag protection, no branch protection anywhere on this repo.

## Findings / gotchas

### 1. The trust boundary is "write access", and it is wider than it looks

- `rulesets` returns `[]`; `tags/protection` returns 404;
  `branches/master/protection` returns 404.
- A tag may point at **any commit** — one never merged to `master`, never
  reviewed, never pushed as a branch. `release.yml` checks out the tag and
  builds it.
- The same absence means all three write collaborators can also push straight
  to `master` unreviewed.
- The test suite does run before the release is cut, but **tests do not detect
  malice** — they detect breakage.

### 2. A release can bypass CI entirely

`gh release create` in CI is the *intended* path, and every release so far is
`author=github-actions[bot]` (checked back through v0.9.3 — clean). But GitHub
write access also permits publishing a release **by hand**, via UI or API, with
arbitrary hand-attached binaries. The updater reads `releases/latest` and has no
opinion about how the release came to exist. CI is a convention here, not a
control.

### 3. The SHA-256 check is integrity, NOT authenticity

This is the most load-bearing misconception to avoid. `updater.rs:273-278` takes
the expected digest from the **same API response** that supplies the download
URL (`asset.digest`), then verifies the downloaded file against it
(`updater.rs:342-348`).

That correctly defeats a truncated or corrupted transfer — which is what it was
written for (venue wifi, resumed partials). It provides **zero** protection
against a malicious publisher, who controls the binary and the digest
simultaneously. There is no signature anywhere in the chain: no minisign key (the
custom updater does not use Tauri's updater plugin), no cosign, no build
provenance attestation, no OS code signing.

**Net:** compromise of any one of four GitHub accounts — or a leaked PAT
belonging to one — yields arbitrary code execution on the rig, with persistence
via the promotion step.

### 4. What limits the blast radius today

- `auto_install: false` by default: a malicious release is *offered*, not
  silently applied. An operator click stands between the attacker and the rig.
  This is the single most valuable mitigation currently in place — do not
  casually flip that default.
- `default_workflow_permissions: read`; `release.yml` scopes up to
  `contents: write` deliberately. Correct.
- `--verify-tag` on `gh release create`.

### 5. Mutable third-party action references

`allowed_actions: all`, `sha_pinning_required: false`. The release job runs
`actions/checkout@v5`, `oven-sh/setup-bun@v2`, `Swatinem/rust-cache@v2`,
`actions/cache@v4`, `actions/upload-artifact@v6`, `actions/download-artifact@v7`
— all mutable tags — and `dtolnay/rust-toolchain@stable`, which is a mutable
**branch**. Any upstream compromise executes inside the job that builds the
binaries the rig installs.

### 6. Cache as an unreviewed input to release builds (secondary)

`release.yml` restores the `release-build` rust-cache (`save-if: false`) that
`warm-cache.yml` writes on `master`. Restored compiled artifacts are an input to
the shipped binary that never passed through code review. GitHub's cache scoping
does prevent fork PRs from poisoning `master`'s cache, so this is a
write-access-only vector — same set of four accounts, no wider.

### 7. Clean on the usual sharp edges

No `pull_request_target`. No `${{ github.event.* }}` / `head_ref` interpolation
inside any `run:` block (no script injection). `BLACKSMITH_ORG_TOKEN` reaches
the runner only as `env:` and is piped to `blacksmith auth login` on **stdin**,
not argv (`cost-gate.yml:134`) — it will not appear in a process list.

## Recommendations, highest value first

1. **Tag-protection ruleset on `v*`** restricting creation to `cinderblock` (or
   a release role). Cheapest, most direct fix for Q1.
2. **Sign the release, verify in the updater.** The real fix for finding 3.
   Either `actions/attest-build-provenance` plus verification in `updater.rs`, or
   a minisign/cosign detached signature over each asset with the public key
   embedded in the binary. Until this exists, "who has write access" *is* the
   security model.
3. **Cheap interim hardening:** have the updater reject any release whose
   `author.login` is not `github-actions[bot]`. Blocks finding 2's hand-published
   release in a few lines, though it is still not authenticity — it trusts the
   API's account field rather than a key.
4. **A GitHub Environment with required reviewers** on `release.yml`'s `release`
   job — a human approval gate GitHub enforces, per release.
5. **Pin actions to full SHAs**; consider `sha_pinning_required: true`.
6. **Branch protection on `master`** requiring PR review, so the write
   collaborators cannot land unreviewed code.
7. **Revisit whether `waterbury`, `ericvicenti`, `allibell` need `write`** — each
   is currently a full path to the rig.

## Things not to do

- Do not flip `auto_install` to `true` as a convenience before item 2 exists — it
  removes the only human check between a compromised account and the show machine.
- Do not read the existing SHA-256 verification as a security control. It is a
  corruption check. Saying "we verify the hash" out loud invites exactly the
  wrong conclusion.
- Never create a repo named `empyrean-gate` under the `cinderblock` account —
  binaries at/below v0.10.9 still poll that path via GitHub's transfer redirect
  and would start reading someone else's releases (already noted in
  `updater.rs:36-38`).

## Open questions for the user

1. Do you want item 1 (tag protection) staged as an ops change now? It needs
   per-change authorization on the GitHub org, so I have not touched it.
2. Preference for item 2: GitHub build provenance attestation, or an embedded
   minisign public key? Recommendation: **attestation** — no key material for
   you to hold or rotate, and it binds the artifact to the workflow and commit
   that produced it.
3. Should the three `write` collaborators keep that level?
