# Blacksmith: stay inside the free tier

## Goal

Keep the Blacksmith CI bill for `TomSawyerLabs/empyrean-gate` at $0/month
between shows, and make paying for speed a one-command toggle for the weeks a
show is on. The 16-vCPU runners are worth paying for when releases are cut many
times a day; they are not worth a standing bill for a project that releases
occasionally. Keep the speed where it is free, drop the spend that bought
nothing, and flip to "spend freely" only on purpose.

## Environment / context

- Repo: `TomSawyerLabs/empyrean-gate` (moved from `cinderblock/empyrean-gate` on
  2026-09-01, commit `e5ca2ec`, which also moved the heavy jobs to Blacksmith).
- Blacksmith org: `TomSawyerLabs`. Dashboard: `https://app.blacksmith.sh/TomSawyerLabs/usage`
  and `.../settings`. Primary/billing email `cameron@tacklind.com`, Visa ending 1189.
- Blacksmith CLI lives in WSL (`Ubuntu-20.04`), authenticated to the org:
  `wsl -e bash -lc 'export PATH=$HOME/.local/bin:$PATH; blacksmith usage --since 30d --breakdown-by runner_type,workflow --format table'`
  Helper: `C:\Users\camer\blacksmith-usage.sh` (run inside WSL as `bash /mnt/c/Users/camer/blacksmith-usage.sh`).
- Runner prices (CLI `runners catalog`): `blacksmith-16vcpu-ubuntu-2404` $0.032/min,
  `blacksmith-16vcpu-windows-2025` $0.064/min. Blacksmith rounds each job up to whole minutes.

## How the free tier actually works (verified on the dashboard, 2026-09-09)

- 3,000 "2 vCPU Linux minutes" per org per month. In practice a **$12 credit**:
  the dashboard's free-tier counter equals `list cost / $0.004`. A 16-vCPU Windows
  minute burns 16 of them, a 16-vCPU Linux minute burns 8.
- The dashboard bills `total usage - usage discount`; the discount covers the
  first $12. Month-to-date on 2026-09-09: $10.34 usage, -$10.34 discount, **$0.00 due**,
  2,584/3,000 free minutes used.
- The CLI's `billing_minutes` column is exactly **2x** the dashboard's free-tier
  minutes. Do not use it for free-tier math; use `cost_usd / 0.004`.
- Blacksmith has **no hard spend cap**. The only control is "Total spend alert"
  under Settings: an email to the primary address when monthly spend (after the
  discount) reaches a threshold. Was $30/month; set to **$1/month** on 2026-09-09.
- Actions cache on Blacksmith: LRU, entries unused for 7 days are evicted (same
  as GitHub). A restore counts as use.

## What the money went on (Sep 2-9, list price)

| Consumer | Jobs | Wall min | Cost |
|---|---|---|---|
| Warm cache, Windows (nightly + on version-bump push) | 17 | 77 | $4.91 |
| Warm cache, Linux (same triggers) | 17 | 45 | $1.45 |
| Release builds, Windows | 6 | 32 | $2.02 |
| Release builds, Linux | 6 | 34 | $1.08 |

- A quiet day (nightly warm only) cost $0.42. That alone eats the $12 credit in
  ~28 days, so every month would have ended a few dollars into paid usage.
- A release costs ~$0.54 warm (Windows 5.3 min + Linux 6.2 min). The warm-cache
  push trigger added ~$0.42 on top of every release because the version bump
  touches `Cargo.toml`/`Cargo.lock`, even though a version bump does not change
  the dependency hash and the re-saved cache was byte-identical (plans/releasing.md
  documents v0.9.3 taking an exact hit on the 0.9.2 key).
- Speed, for the record: release builds went from 13-15 min (Linux) and 15-23 min
  (Windows) on GitHub's free 4-vCPU runners to ~6 and ~5 min on Blacksmith.
  macOS on GitHub's free runner is now the long pole at ~13 min.

## Decisions already made (don't re-ask)

- **Kill the nightly warm-cache cron and the Cargo.lock push trigger.** Done
  2026-09-09; `warm-cache.yml` is `workflow_dispatch` only. Reason: they were
  two thirds of the bill and bought nothing a release could not get by restoring.
- **Keep release builds on Blacksmith 16-vCPU.** ~$0.54 per release means ~22
  releases/month inside the free tier, far above the post-show cadence, and the
  release-profile cache only exists on Blacksmith's backend.
- **macOS stays on GitHub's free runner.** Blacksmith bills macOS at 20x Linux.
- **checks.yml stays on GitHub runners** (fork PRs).

## Plan / steps

- [x] Measure before/after speed from GitHub run data and real spend from the
      Blacksmith CLI + dashboard.
- [x] Make `warm-cache.yml` manual-only; rewrite its header with the cost reasoning.
- [x] Update the restore comment in `release.yml`, the CI sentence in README, and
      `plans/releasing.md`.
- [x] Stop the cron immediately: `gh workflow disable warm-cache.yml` on GitHub
      (2026-09-09, state `disabled_manually`). Belt and braces until the commit is
      on origin/master, since `schedule` runs from the default branch's copy of the
      file. Once the push lands, `gh workflow enable warm-cache.yml --repo
      TomSawyerLabs/empyrean-gate` makes manual dispatch available again; with no
      schedule in the file, enabling it costs nothing.
- [x] Push to origin/master (2026-09-09, with Cameron's go-ahead; the push also
      carried other sessions' pending master commits, fast-forward). Workflow
      re-enabled afterwards so manual dispatch works; no schedule remains.
- [x] Spend alert lowered from $30 to $1/month on the dashboard (2026-09-09,
      Cameron approved; confirmed after reload, toast "Successfully updated email
      alert threshold"). The email now fires the moment paid usage starts.
- [x] Workflow-enforced cap: built 2026-09-10 as `.github/workflows/cost-gate.yml`
      after Cameron asked what it would take. Inert until the secret exists.
- [x] Org token minted (label `ci-cost-gate`, Cameron approved in the browser on
      2026-09-10) and stored as the `BLACKSMITH_ORG_TOKEN` repo secret; the log
      that briefly held it was shredded. **The gate is live.**
- [x] Proved the live path (2026-09-10, build.yml run 34524138107, cancelled
      seconds after the gate reported): CLI install, org-token login, and usage
      query all worked; decision "month-to-date Blacksmith list cost $10.944 is
      under the $11.30 threshold; Blacksmith runners", and the build jobs were
      created with the Blacksmith labels.
- [x] Proved the GitHub-runner path for free (2026-09-10, build.yml run
      34439672577 with `force_fallback=true`): gate 0 min on ubuntu-latest, then
      windows-latest 25 min, ubuntu-latest 16 min, macos-latest 13 min, all
      green, $0 on Blacksmith. Those are the cold times a diverted release pays.
- [x] Show-mode toggle (2026-09-11, Cameron asked): `SHOW_MODE` repository
      variable, read by the gate and by warm-cache's nightly cron. Created set to
      `false`.
- [ ] Prove the toggle live: set `SHOW_MODE=true`, dispatch build.yml, confirm
      the gate's reason names show mode, cancel, set it back to `false`.

## Show mode: the toggle

One repository variable, no commit, takes effect on the next run:

```
gh variable set SHOW_MODE --body true  --repo TomSawyerLabs/empyrean-gate   # on
gh variable set SHOW_MODE --body false --repo TomSawyerLabs/empyrean-gate   # off
gh variable get SHOW_MODE --repo TomSawyerLabs/empyrean-gate                # ask
```

While it is `true`:
- cost-gate.yml hands out the Blacksmith labels regardless of month-to-date
  spend (reason line says so), for release.yml, build.yml and warm-cache.yml.
- warm-cache.yml's nightly 09:00 UTC cron actually runs (~$0.42/night). Outside
  show mode the cron still fires but its gate job is skipped, which allocates no
  runner and costs nothing. The Cargo.lock push trigger is gone for good.
- The $1 spend alert on the Blacksmith dashboard still emails on the first paid
  dollar. Raise it on the dashboard for the show if that is unwelcome; that is a
  per-change authorization from Cameron, not something to do automatically.

Show-mode cost, from August's cadence (19 releases in 5 days): ~$0.55/release
plus $0.42/night, so a two-week show with ~40 releases is roughly $28 list, $16
after the free tier.

## Expected steady state

- Idle month: **$0**. Nothing runs on Blacksmith unless a tag is pushed or a
  workflow is dispatched by hand.
- Per release: ~$0.54 while the cache entry is alive; under $1 cold. Cold happens
  only after 7+ days with no release. Run the warm workflow first if a fast
  release matters that day:
  `gh workflow run warm-cache.yml --repo TomSawyerLabs/empyrean-gate`
- Manual `build.yml` dispatches also cost ~$0.54 each (same runners).

## The cost gate (built 2026-09-10)

`.github/workflows/cost-gate.yml` is a reusable workflow called first by
release.yml, build.yml, and warm-cache.yml. On GitHub's free ubuntu runner it
installs the Blacksmith CLI, logs in with `BLACKSMITH_ORG_TOKEN`, reads the
calendar month's list cost, and outputs runner labels:

- under the threshold (default **$11.30** = $12 minus one release): the
  Blacksmith 16 vCPU labels, `over_budget=false`.
- at or over it: `windows-latest` / `ubuntu-latest`, `over_budget=true`. Release
  and manual builds still ship, cold (~20 min) and free. warm-cache skips
  entirely, because a cache saved on GitHub's backend is unreadable from
  Blacksmith runners.
- **no token**: Blacksmith labels and a "gate inactive" note. That is the
  pre-gate behaviour, so the workflow landed safely before the secret existed.
- token present but anything fails (install, login, API): GitHub runners.
  Fail closed: a slow free build beats an open-ended bill, and a release is never
  blocked by the gate, only slowed.

Its decision is written to the run's step summary. build.yml has a
`force_fallback` dispatch input that skips the lookup and diverts, which is the
free way to test the GitHub path.

Verified locally on 2026-09-10 in WSL with the user token: the date window,
`jq` extraction and `awk` comparison behave, and
`blacksmith auth login --api-token - --non-interactive --organization TomSawyerLabs`
accepts a token on stdin.

### Turning the gate on (done 2026-09-10; kept for re-issuing the token)

1. Mint an org token (org admin; opens a browser to verify):
   `wsl -e bash -lc 'export PATH=$HOME/.local/bin:$PATH; blacksmith org-token create --label ci-cost-gate'`
   It prints once. Note it is broader than read-only: org tokens can also delete
   cache entries and manage testboxes. Release/build/warm only run on tag pushes
   and manual dispatch, never on fork PRs, so only people who can already push
   tags can reach it.
2. Store it: `gh secret set BLACKSMITH_ORG_TOKEN --repo TomSawyerLabs/empyrean-gate`
   (paste when prompted).
3. The next run of any of the three workflows shows the real decision in its
   step summary.

### Known gaps

- A running job is not in the usage figure until it finishes, so two tags
  pushed minutes apart both pass. One extra release, ~$0.60, not a runaway.
- The usage API lagged a finished run by under two hours when checked; the
  exact lag is unmeasured.
- Blacksmith's billing period is assumed to be the calendar month in UTC (the
  dashboard showed "Sep 1 - 9, 2026").

## Things not to do

- Do not put the warm cache on GitHub runners to make it free: GitHub and
  Blacksmith caches are separate backends, so Blacksmith release jobs could not
  read it and every release would be cold.
- Do not re-add a `push` trigger filtered on `Cargo.lock`: version bumps change
  that file too, so it fires on every release.
- Do not read free-tier headroom from the CLI's `billing_minutes`; it double
  counts relative to the dashboard.
- Do not change the Blacksmith dashboard (alert threshold, region, tokens)
  without a per-change yes from Cameron.
