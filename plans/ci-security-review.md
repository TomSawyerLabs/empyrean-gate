# CI / release-channel security review

**Status:** review complete; remediation in progress (2026-09-17).

## Decisions already made (do not re-ask)

Approved by the user on 2026-09-17, in response to the four recommendations
below:

1. **Tag-protection ruleset on `v*`, creation restricted to `cinderblock`** —
   approved. Staged as `plans/ci-tag-ruleset.json`, **not yet applied**: it is a
   GitHub org change and needs explicit per-change authorization.
2. **Sign releases in CI** — approved, with "sign in CI" called out explicitly.
   Provenance attestation chosen over an embedded minisign key. *Partially
   done*; see "The signing gap" below — the CI half is committed, the
   install-time enforcement half needs one more decision.
3. **Updater rejects releases not authored by `github-actions[bot]`** —
   approved and **done** (`3ba6a1c`).
4. Environment reviewers / SHA-pinning / branch protection — user asked for
   elaboration; written up under "Item 4, elaborated".
5. **`waterbury`, `ericvicenti`, `allibell` keep `write`.** Settled — the answer
   to finding 1 is tag protection, not reducing headcount.

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

## The signing gap (item 2, and why it is not finished)

The CI half is committed (`3ba6a1c`): `actions/attest-build-provenance@v3` now
signs a provenance statement per release asset, binding its SHA-256 to the
workflow, commit and tag. Any asset can be checked after the fact with:

```
gh attestation verify empyrean-gate-windows-x64.exe --repo TomSawyerLabs/empyrean-gate
```

**What that does not do is gate the install.** Verifying a Sigstore bundle
offline requires the Sigstore TUF trust root plus a Rekor inclusion proof — the
Fulcio certificate is valid for ~10 minutes, so without a trusted timestamp from
the transparency log there is no way to know the signature was made while the
cert was live. Reimplementing that in `updater.rs` (currently a blocking `ureq`
client and ~25 lines of `sha2`) means either pulling in `sigstore-rs` and its
async stack, or hand-rolling certificate-chain and log-proof verification. Both
are a large amount of security-critical code whose failure mode is a rig that
either refuses good updates mid-show or accepts bad ones.

This was not clear when attestation was recommended, and it is the one place the
earlier recommendation was too optimistic.

**Recommended resolution: do both, because they cost different things.**

- Keep attestation as the auditable, key-less provenance record (done).
- Add an **ed25519 detached signature** over each asset in the same release job,
  with the public key embedded in the binary. In-app verification is
  `ed25519-dalek` and about 25 lines, offline, no trust root to keep fresh.
  This becomes what the updater actually enforces.

The objection to a long-lived signing key is that anyone able to run a workflow
could sign arbitrary bytes with it. That is answerable with GitHub's own
controls, and it is why this pairs with item 1 and item 4:

- Put `RELEASE_SIGNING_KEY` in a **GitHub Environment** (`release`) rather than
  as a plain repo secret.
- Give that environment a **deployment tag rule of `v*`**, so no workflow run
  from a branch can reach the key.
- With `v*` tag creation restricted to `cinderblock` (item 1), the only way to
  produce a signature is a tag only they can push.

Net effect: the signature is cryptographic proof the asset came from a release
the repo owner initiated, checkable on the show machine with no network and no
Sigstore machinery.

## Item 4, elaborated

Three separate things were bundled together; they differ a lot in value and cost.

### 4a. A GitHub Environment with required reviewers — recommended

An Environment is a named gate a job can be attached to (`environment: release`),
with two properties worth having:

- **Required reviewers**: the `release` job pauses and will not run until a named
  person clicks approve, in the Actions UI. The build still runs; only publishing
  waits. So a pushed tag no longer silently becomes a live release.
- **Deployment branch/tag rules**: restricts which refs may use the environment
  *and its secrets*. This is the piece that makes a CI signing key safe (above).

Cost: a couple of lines in `release.yml` plus one settings page. The reviewer
click is a real cost on every release, but this repo cuts releases in bursts
(six in the last two weeks of August), so consider whether the approval fatigue
is worth it **once signing exists** — at that point the signature already proves
provenance, and the reviewer gate is mostly protection against a compromised
`cinderblock` account. My read: **adopt the environment for the deployment tag
rule** (needed for signing regardless), and treat required reviewers as
optional, probably off, given a one-person release process.

### 4b. Pinning actions to full SHAs — recommended, low urgency

Today every third-party action floats on a mutable reference:
`actions/checkout@v5`, `oven-sh/setup-bun@v2`, `Swatinem/rust-cache@v2`,
`actions/cache@v4`, `actions/upload-artifact@v6`, `actions/download-artifact@v7`,
`actions/attest-build-provenance@v3`, and `dtolnay/rust-toolchain@stable` — the
last being a mutable *branch*, the loosest of the set. If any of those
repositories were compromised, the malicious code runs inside the job that
builds the binary the rig installs, with the release token in scope.

The fix is `uses: actions/checkout@<40-char-sha>  # v5.0.1` and turning on
`sha_pinning_required`. The real cost is maintenance: pinned actions stop
receiving fixes silently, so this wants Dependabot (`package-ecosystem:
"github-actions"`) configured at the same time, or the pins rot and you end up
worse off. Recommend doing both together, as one change, not urgently.

Worth noting the asymmetry: `actions/*` are first-party and a compromise there is
an industry-wide event. `dtolnay/rust-toolchain` and `Swatinem/rust-cache` are
single-maintainer repos, and `@stable` is a branch. If only part of this gets
done, pin those two.

### 4c. Branch protection on `master` — optional, mostly orthogonal

This was on the list because `master` has no protection at all, so the three
write collaborators can push unreviewed commits. With tag protection in place
this is **no longer a release-channel risk** — unreviewed code on `master` does
not reach the rig unless `cinderblock` tags it.

So it is now a code-quality question rather than a security one, and it has a
genuine downside: a required-PR rule applies to the owner too, and would get in
the way of how this repo is actually worked (direct pushes to `master`, multiple
concurrent agent threads). Recommendation: **skip it**, or at most require the
`Checks` workflow to pass, without requiring review.

## Signing, as built (2026-09-17)

Resolved in favour of the "do both" option above. `673e064`.

- **CI** (`release.yml`, `release` job, `environment: release`): openssl makes an
  ed25519 detached signature per asset, published as `<asset>.sig` (128 hex
  chars). Message, no trailing newline:
  `empyrean-gate-release-v1\n<version>\n<asset>\n<sha256>`.
- **App** (`updater.rs`): public key committed at `src-tauri/release-signing.pub`
  and embedded with `include_str!`; `verify_staged_file` computes the digest
  locally, compares it to the API's, then verifies the signature over the
  *locally computed* digest. A release with no `.sig` asset is refused in
  `check_latest`, so it is never offered.
- **Already-staged siblings are re-verified.** They previously passed on a digest
  comparison alone, which would have let a binary staged before enforcement — or
  altered while it sat there overnight — launch unchecked.

### Guards against the failure that would strand the fleet

The dangerous mistake is the CI key and the embedded key not being a pair: every
fielded copy would reject every future update, discoverable only after release.
Two independent checks:

1. `release.yml` rebuilds the public key from the committed
   `release-signing.pub` and verifies its own freshly made signature against it.
   Fails the release if it does not match.
2. `updater::tests::the_shipped_public_key_matches_the_signing_key_used_in_ci`
   asserts the same pairing on every `cargo test`, via a signature over a fixed
   synthetic triple (`0.0.0-keycheck`, all-zero digest).

**Both must be regenerated if the key is rotated** — see the doc comment on that
test for the exact commands.

### Gotchas found while building it (do not rediscover)

- **`openssl pkey -pubin -inform DER` does not honour `-pubin` on stdin** — it
  reports `Could not find private key of Public Key` and exits nonzero. The
  working route is assembling the PEM armor by hand:
  `-----BEGIN PUBLIC KEY-----` + base64 of
  `302a300506032b6570032100` ++ the 32 raw key bytes.
- **`set -euo pipefail` did not abort the loop** when `openssl pkeyutl -verify`
  failed in a local dry run of the step. The self-check that exists specifically
  to fail the release is therefore written as an explicit
  `if ! openssl …; then exit 1; fi`, not left to shell error handling. Worth
  remembering for any future guard in these workflows.
- Dry-running the step is worth it: extract it with
  `yaml.safe_load` → `jobs.release.steps[name="Sign release assets"].run`, run it
  against a fake `assets/` tree, and check the three failure modes (missing
  secret, garbage secret, mismatched public key) all exit nonzero and publish no
  `.sig`. All three were verified before commit.
- `head -c 1500000 /dev/urandom` is pathologically slow under Git Bash on this
  machine — it blew a 120 s tool timeout. Use `yes … | head -N` for fixtures.

## Progress log

- [x] Review access, rulesets, workflows, updater trust chain (2026-09-17).
- [x] Item 3 — updater refuses non-`github-actions[bot]` releases (`3ba6a1c`).
      `cargo check` clean, 250 lib tests pass.
- [x] Item 2, CI half — `attest-build-provenance` on every release asset
      (`3ba6a1c`), with per-job `id-token`/`attestations` permissions.
- [x] Item 1 — tag ruleset **applied by the user** 2026-09-17. Verified live:
      ruleset id `23616688`, target `tag`, active, rules
      `creation`/`update`/`deletion` on `refs/tags/v*`, sole bypass actor
      `User:419955` (`cinderblock`).
- [x] Item 2, enforcement half — ed25519 signature + embedded public key
      (`673e064`). 257 lib tests pass.
- [x] Item 4a — `release` environment created and armed, 2026-09-17. Verified:
      one protection rule, type `branch_policy` (no required reviewers, no wait
      timer); deployment policy `name=v*  type=tag` (id `60274225`);
      `RELEASE_SIGNING_KEY` present **in the environment**, and repo-level
      secrets still hold only `BLACKSMITH_ORG_TOKEN`.
- [ ] **Delete `~/empyrean-release-signing-key.pem`** — deliberately still
      present. `gh secret list` proves the secret exists but not that its
      contents are intact, and it is write-only afterwards. If the upload were
      subtly wrong the fix is to re-upload; with the local copy gone the only
      fix is a key rotation, which is a two-release operation. Delete it after
      the first release that signs successfully.
- [ ] First signed release — the one untested link is whether a tag-triggered
      run can read the environment secret. Failure is safe by construction: the
      guard aborts the job before publishing, so the worst case is a failed
      release, never an unsigned one.
- [ ] Item 4b — SHA-pin actions + Dependabot for `github-actions`.
- [ ] Item 4c — decided against for now (see above).

## Handover — the three commands that arm signing

**DONE 2026-09-17**, authorized by the user. Recorded here as the record of what
was applied and how to reproduce or undo it.

The private key is at `C:\Users\camer\empyrean-release-signing-key.pem`
(ACL restricted to `camer`). Its public half is committed at
`src-tauri/release-signing.pub`.

**1. Create the `release` environment and allow only `v*` tags to use it.**

```
gh api -X PUT repos/TomSawyerLabs/empyrean-gate/environments/release \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'

gh api -X POST repos/TomSawyerLabs/empyrean-gate/environments/release/deployment-branch-policies \
  -f name='v*' -f type=tag
```

**2. Load the signing key into that environment** (Git Bash):

```
gh secret set RELEASE_SIGNING_KEY \
  --env release \
  --repo TomSawyerLabs/empyrean-gate \
  < ~/empyrean-release-signing-key.pem
```

Or PowerShell:

```
Get-Content "$env:USERPROFILE\empyrean-release-signing-key.pem" -Raw |
  gh secret set RELEASE_SIGNING_KEY --env release --repo TomSawyerLabs/empyrean-gate
```

**3. Delete the local private key** — CI is the only place it should exist:

```
Remove-Item "$env:USERPROFILE\empyrean-release-signing-key.pem"
```

Keep a copy in a password manager first **only if** you want to be able to
re-point the same key later; losing it is recoverable anyway (generate a new
pair, update `src-tauri/release-signing.pub`, regenerate the probe signature in
`updater.rs`, ship a release — fielded copies verify against the key *they*
shipped with, so a rotation needs one release signed by the OLD key to carry the
new public key out, then the next release can use the new one).

**Verify afterwards:**

```
gh api repos/TomSawyerLabs/empyrean-gate/environments/release/deployment-branch-policies
gh secret list --env release --repo TomSawyerLabs/empyrean-gate
```

### The initial rollout is safe (checked)

Enforcement does not strand anything already in the field, because the copy doing
the installing is the one that decides:

- v0.11.0 and older have no signature code, so they install the next release on
  the digest check alone — as they always did. They are not broken by `.sig`
  assets appearing.
- The first release built from `673e064` onward both ships the enforcing updater
  and is itself signed, so from that point every copy verifies every subsequent
  release against the key it shipped with.

So there is no chicken-and-egg step and no flag day. The only ordering
requirement is the one below, for rotation.

### Key rotation is a two-release operation — do not do it in one

Fielded binaries verify against the key compiled into them. Shipping a release
signed by a NEW key that fielded copies have never seen means they reject it and
stop updating — permanently, without a manual reinstall. To rotate: release N
carries the new `release-signing.pub` but is still **signed by the old key**;
release N+1 is signed by the new one. Anything older than N needs a manual
download.

## Things not to do

- Do not read the SHA-256 verification as a security control. It is a corruption
  check — the digest and the download URL come from the same API response.
  Saying "we verify the hash" out loud invites exactly the wrong conclusion. The
  ed25519 signature is the control; the hash is what makes a resumed download
  safe.
- Do not rotate the signing key in a single release (see above), and do not
  change `signing_message`'s format without regenerating the test vector — the
  two implementations must agree byte for byte.
- Do not add `|| true` or drop the explicit `if !` around the signature
  self-check in `release.yml`. A dry run showed `set -e` does not reliably abort
  there, and a guard that cannot fail the release is decoration.
- `auto_install` is now defensible to turn on if wanted — a published release
  has to carry a valid signature from an owner-pushed tag. Still a show-safety
  decision rather than a security one now, so leave it to the operator.
- Never create a repo named `empyrean-gate` under the `cinderblock` account —
  binaries at/below v0.10.9 still poll that path via GitHub's transfer redirect
  and would start reading someone else's releases (already noted in
  `updater.rs:36-38`).

## Open questions for the user

1. **Cut a release when ready** — nothing blocks one now. Delete the local
   private key once it succeeds (see progress log for why it is still there).
2. Item 4b — SHA-pin the actions and add Dependabot for `github-actions`? Worth
   doing, not urgent, and best as one change so the pins do not rot.
3. Required reviewers on releases: my read is still **no** now that signing
   exists — the signature already proves provenance, and the reviewer gate would
   mostly guard against a compromised owner account.

`plans/ci-tag-ruleset.json` is kept as the record of what was applied; the
ruleset is live as id `23616688`. To undo it:
`gh api -X DELETE repos/TomSawyerLabs/empyrean-gate/rulesets/23616688`.
