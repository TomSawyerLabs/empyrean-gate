# A PRO DJ LINK simulator for the web

## Goal

Patches that use the `dj_link` node cannot be built or checked anywhere but
a gate with CDJs on its network. The web runtime (`packages/patch-web`) fed
it a thin stand-in (`grooveDjLink`): `active` always 1, deck 1 on air
forever, a frozen phrase (`phrase_kind` 1), no event ever firing on its own,
and only 6 of the 11 events reachable from the playground's buttons.

Cameron (2026-10-18): "go for a first implementation. boil the ocean". So:
a simulator that behaves like a real two-deck PRO DJ LINK set, as the gate
itself would read it, everywhere the web runtime runs (the empyreangate.org
playground, the CLI's `render`, the MCP server's `snapshot`).

## Environment / context

- Gate repo: `TomSawyerLabs/empyrean-gate`. This work: worktree
  `C:\Users\camer\.t3\worktrees\Empyrean\dj-sim`, branch `dj-sim`, from
  `origin/master` ee1c0b9. The main checkout (`Personal Projects\Empyrean`)
  is 100+ commits behind and other threads share it: don't use it.
- Site repo: `cinderblock/empyreangate.org`, shared checkout `Personal
  Projects\empyreangate.org` (several agents, see its `.agents.txt`, where
  this thread is "Agent K — dj-link-sim"). Site work goes in its own
  worktree `C:\Users\camer\.t3\worktrees\empyreangate.org\dj-sim`, branch
  `dj-sim` → `dev`. Never the site's `master`.
- Pipeline: gate `master` → CI `web-dist.yml` publishes the `web-dist`
  branch → the site's `web-dist-bump.yml` bot (every 15 min) bumps `bun.lock`
  on site `dev` after typechecking, testing and building. **Don't bump
  `bun.lock` by hand.** The bot typechecks the *old* site code against the
  *new* package, so the package change must stay source-compatible with the
  site as it is (see Decisions).
- The real thing: `src-tauri/src/rhythm.rs` (CDJ status → `PioneerVisualEvent`s,
  the visual snapshot), `src-tauri/src/engine/mod.rs` ~2250 (mix easing) and
  ~2920–3020 (phrase key, `DjLinkInputs`), `src-tauri/src/prolink_analysis.rs`
  (`active_phrase`, `phrase_kind_code`). The wasm takes the 18 scalars with
  `setDjLink` (order in `crates/empyrean-patch-wasm/src/lib.rs`) and events by
  index with `fireDjEvent` (`crates/empyrean-patch/src/eval.rs` `DJ_EVENT_*`).

## Decisions already made (don't re-ask)

- **TypeScript in patch-web, not Rust in the crate.** The simulator is a
  host-side stand-in like the groove, not a patch rule; the wasm ABI
  (`setDjLink` / `fireDjEvent`) is untouched, so no wasm change. A desktop
  "simulated LINK" source is a separate question (Open questions).
- **Model the hardware, then derive what the gate sees with the gate's own
  rules.** The CDJs are simulated as Pioneer play modes (0x03 playing, 0x04
  looping, 0x05 paused, 0x06 cued, 0x07 cue-play), on-air and master flags and
  beat numbers; a port of `rhythm.rs`'s diff turns those into events, and of
  the engine's code into `mix` / `mix_activity` / phrase. So the quirks match:
  cue-play fires `play` *and* `cue`; Play from a cued deck fires `play` and
  `cue_release`; a loop's first jump back is `loop_start`, not a wrap; a jump
  is a beat discontinuity (back > 1 or forward > 8 beats); `mix` takes only 0,
  0.5 and 1 from the on-air flags, eased over 0.9 s.
- **One tempo: the set runs at 122 BPM** (`GROOVE_BPM`), the decks beatmatched
  to it as a DJ would. Every "122 BPM groove" sentence in docs stays true.
- **The groove follows the set.** The synthetic audio is the sound of what is
  on air: the kick drops out in a breakdown, a build rises, a fill-in rolls,
  two decks blend through the crossfader, stopped decks are silent. The
  microphone still replaces it.
- **Unplugging LINK doesn't stop the music:** "LINK connected" off makes every
  `dj_link` output 0 (what a gate without CDJs gives), the groove plays on.
- **Deterministic.** The set is a function of time from its start; `restart()`
  (an agent's capture) returns to a start point the host chooses, so captures
  repeat.
- **Auto DJ is a policy, not a timeline:** it reads the decks' state each frame
  and acts, so it can resume from anything a person did by hand. A person's
  deck action turns Auto off.
- **Source compatibility for the bump bot:** `GrooveSettings.djMix` stays as a
  deprecated, ignored field until the site stops setting it; `fireDjEvent`
  keeps working.
- Tracks are invented (titles/artists made up), not real songs.

## Plan / steps

1. [x] Survey: the stand-in, the engine's derivations, consumers, pipeline.
2. [ ] **`src/runtime/djlink.ts`**: crate of tracks (phrases, fill-ins,
   performance moves), `CdjDeck`, the mixer, `GateLinkView` (the gate's
   derivations), `DjLinkSim` (step, manual controls, auto policy, `reset(at)`,
   `scalars()`, events, `audio()`, `state()` for UIs).
3. [ ] `groove.ts`: `attachGroove` drives the set; audio from the set;
   returns `dj`; `grooveDjLink` removed; `djMix` deprecated. Exports in
   `runtime/index.ts`.
4. [ ] Tests (`bun test src`): event rules vs `rhythm.rs`, mix easing, phrase
   key, every event within one auto cycle, determinism, `reset(at)`,
   disconnected zeros, the scalars' order against the registry's `dj_link`
   outputs, the breakdown dropping the bass.
5. [ ] Agent: a shared `dj_deck` tool (`src/agent/dj.ts`) — read the deck,
   connect/disconnect, auto on/off, start the set at a time, deck actions;
   guide text. CLI: `render --at <s> --no-link`; MCP serves `dj_deck`.
6. [ ] README (patch-web), typecheck, tests, browser test; commit; merge to
   gate master; watch CI publish web-dist.
7. [ ] Site (own worktree): the DJ panel (two decks with play / hold-cue /
   loop / jump / load, phrase strip, master & on-air lamps, crossfader, Auto
   DJ, LINK connected, event lamps), `set_inputs` → `dj_deck`, README,
   tests; after the bot's bump lands, push `dev`, verify the Preview.
8. [ ] Gate follow-up: drop `GrooveSettings.djMix` once the site no longer
   sets it.

## Findings / gotchas

- `active` on the gate is `selected && (clock usable || visual active || has
  devices)`: with CDJs on the network it stays 1 while stopped; `energy` is 0
  when nothing plays (`pioneer_energy`: followed deck if playing, else any
  playing deck).
- `phrase_change` fires when the (player, track, phrase number) key changes,
  so a master handoff to the other deck fires it too; `fill_in` fires when the
  same phrase's fill becomes active.
- `beat_in_bar` comes from beat packets (only sent while playing); it holds
  its last value while stopped.
- Events are edge-detected per frame by `event_seq` in the evaluator: two
  firings of one event in a single frame count once.

## Progress log

- [x] 2026-10-18: survey; plan written; `.agents.txt` entry in the site
      checkout.

## Open questions for the user

1. A "simulated LINK" source in the desktop gate (for testing a gate with no
   CDJs at home)? It would mean the same model in Rust feeding the engine's
   Pioneer path. Recommendation: not now; the web simulator covers building
   patches, and the CDJ hardware test plan covers the real thing.
2. An audible set (Web Audio synthesizing the kick, hats and pads the
   simulator describes) so the playground can be *heard*? Recommendation:
   later, if wanted; autoplaying sound needs a click anyway.

## Things not to do

- Don't bump the site's `bun.lock` by hand (the bot does it; two bumps rebase
  onto each other).
- Don't break the site's current code against the new package (the bot's
  typecheck would block every other agent's bump).
- Don't work in the gate's main checkout or commit in the shared site
  checkout's index with a bare `git commit`.
