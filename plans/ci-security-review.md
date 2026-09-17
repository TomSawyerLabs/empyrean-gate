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

## Progress log

- [x] Review access, rulesets, workflows, updater trust chain (2026-09-17).
- [x] Item 3 — updater refuses non-`github-actions[bot]` releases (`3ba6a1c`).
      `cargo check` clean, 250 lib tests pass.
- [x] Item 2, CI half — `attest-build-provenance` on every release asset
      (`3ba6a1c`), with per-job `id-token`/`attestations` permissions.
- [ ] Item 1 — tag ruleset staged in `plans/ci-tag-ruleset.json`, **awaiting
      authorization to apply**.
- [ ] Item 2, enforcement half — ed25519 signature + embedded public key,
      pending the decision in "The signing gap".
- [ ] Item 4a — `release` environment with a `v*` deployment tag rule (needed by
      the signing work).
- [ ] Item 4b — SHA-pin actions + Dependabot for `github-actions`.
- [ ] Item 4c — decided against for now (see above).

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

1. **Authorization to apply the tag ruleset** in `plans/ci-tag-ruleset.json`?
   The exact command is in that file's companion note below. Nothing has been
   applied.
2. **Add the ed25519 signature the updater actually enforces?** See "The signing
   gap". Recommendation: yes — attestation alone does not gate the install, and
   this is the difference between an audit trail and a control. Needs a
   `release` Environment plus a generated keypair, so it needs authorization
   too.
3. Required reviewers on releases: my read is **no** once signing exists (see
   4a), but it is a judgement call about how much you trust the single admin
   account.

### The exact command for item 1 (not run)

```
gh api -X POST repos/TomSawyerLabs/empyrean-gate/rulesets \
  --input plans/ci-tag-ruleset.json
```

Blocks creation, update and deletion of `refs/tags/v*` for everyone except
`cinderblock` (user id `419955`). Verified beforehand that the repo currently has
zero rulesets, so this adds rather than replaces. It does not affect
`release.yml`: the workflow publishes a *release* against an already-pushed tag
(`gh release create --verify-tag`) and never creates tags, so it needs no bypass
entry.

Two variants, if the `User` actor type is rejected by the API — swap the
`bypass_actors` entry for:

```
{ "actor_id": 1, "actor_type": "OrganizationAdmin", "bypass_mode": "always" }
```

(`actor_id` is ignored for that type). That grants bypass to org owners as a
class rather than to one account, which is equivalent today — `cinderblock` is
the sole owner — but would widen automatically if an owner were ever added.

To undo: `gh api -X DELETE repos/TomSawyerLabs/empyrean-gate/rulesets/<id>`.
