# Show feedback, September 2026 — feature requests and fixes

## Goal

Capture every request Cameron brought back from the last show (dictated
2026-09-09) so none are lost, then land them as separate commits. Items are
numbered for cross-reference; each carries its current status and the code it
touches. This file is the single place to look for "did we do X yet".

## Environment / context

- Repo `~/git/Personal Projects/Empyrean`, branch `master`, v0.10.15 shipped.
- Frontend React 19 + Vite in `src/`; backend Rust/Tauri in `src-tauri/src/`,
  frame loop `engine/mod.rs::run_frames`, WebSocket server `server.rs`.
- Checks: `bun run typecheck`, `bun run test:layout`, `bun run test:behavior`,
  `cargo test --lib` in `src-tauri` (local toolchain works).
- Shared working tree: stage files explicitly, append to
  `.agent-commit-coordination` before pushing.

## Decisions already made (don't re-ask)

- Fade times are constants next to `GAME_FADE_SECS`/`TEST_FADE_SECS`, not config
  knobs (carried over from `plans/no-hard-cuts.md`).
- Turning sACN output off stays instant.
- No per-frame allocation on the sACN path.
- `MasterDropDetector`/`AudioBrightnessFollower` taus untouched.
- Each request lands as its own commit ("most of these changes should be
  separate commits").
- Finished plan docs are deleted in their own commit with a one-line
  explanation.
- **F14 (Cameron, 2026-09-10): one global Ready bus stays the design.** It owns
  a whole GPU render bus, so it is not multiplied per client. Per-client
  *private* Ready buses only if a show actually needs them, and then with a
  separate small cap (2–3) for the same reason.

## The requests

### A. Live controls

1. **Cursor colour left, global colour right; global is a slider, not a toggle.
   Same for flourish.** The per-touch (cursor) colour belongs with the tools on
   the left; the global colour and flourish belong with the global settings on
   the right, and neither is an on/off toggle — just a slider that starts at
   zero. Status: DONE — landed in e6f1e96 ("Live controls: color joins the
   tools, toggles become sliders, faders track the finger"): colours moved to
   the left tools column, master hue's checkbox became the Amount slider (0 =
   off), Flourishes became a 0..1 slider. Nothing further to do.
2. **Multitouch: changing colour while another finger is dragging doesn't seem
   to work.** Status: DONE. Root cause: swatches fire on native `click`, and
   browsers only synthesize `click` for the primary pointer — a second finger
   is non-primary, so its tap never landed. `src/dragRouter.ts` now fires the
   pressed pad on release for non-primary pointers (and absorbs a duplicate
   click if a browser sends one). The shared master-fader drag flag became a
   per-pointer Set. Test: `tests/multitouch.spec.ts`.

### B. Layers and taps

3. **Pro controller can turn off all layers, and taps must stop too.** A guest
   VJ turned every layer off in the right panel, but taps (effects/dabs) kept
   rendering. Effects and dabs are composited after the layer stack in
   `gate.wgsl` and are independent of layer enables. Status: DONE (b7bf3ab):
   `render.floor_level` "Floor input" fader on Live + Control master clusters,
   glided in the engine, scales every effect/dab; quick-setting target; Control
   → Layers has All off / All on.
4. **Enable more layers by default, but toggled off.** Default config seeds a
   small stack; ship more kinds in the default stack with `enabled: false` so
   an operator can switch them on without building them. Status: DONE
   (6b8a028): eight tuned shelf layers, `enabled: false`; Ready names the
   program by enabled layers only.

### C. Clients

5. **Connected-clients indicator on the main dashboard, with recent inputs and
   quick disable toggles.** Show the client list in order, with a cutoff line
   where the preview-viewer limit falls. Today: `status.client_list` exists
   (id/name/connected/revoked/admin), the Live status grid shows a bare count
   (`src/Live.tsx` ~677), revoke lives in Settings → Clients, and the only
   "who sent what" record is the 22 s report timeline (`report.rs`), never
   pushed to the UI. Status: DONE (ba3f0bf): `ClientRoster` under the Live
   "clients" stat and as a Control panel — arrival order, last input + age,
   dashed cutoff at the viewer-slot limit, Block/Unblock (revoke is admin-level
   now, not loopback-only).
6. **Ask clients to pick a name, generated two-word default** from a
   festival / Burning Man / nerdy word list. Today: `SetClientName` exists and
   guests may send it, but the only input for it is in Settings (admin-only),
   so guests never see it; default is `device-<last4>`. Status: DONE
   (b710933): `src/deviceNames.ts` mints "Dusty Badger" on first use; ☺ name
   chip in the top bar / phone menu with a rename dialog; pulses until
   confirmed.
7. **Wi-Fi QR next to the connect QR**, credentials entered manually when
   enabled, shown in the full-page connect modal with a big title and simple
   instructions, separated for clean scanning. Plus an admin button that
   produces a PDF/PNG with a longer-term token for event staff to post.
   Today: QR is server-rendered SVG at `/qr.svg` (`qrcode` crate); the join
   token never expires; no Wi-Fi fields in config; no print/PNG export
   anywhere. Status: DONE (0fbe5be): Settings → Clients holds the Wi-Fi
   credentials; ⊕ Connect shows "1 · Join the Wi-Fi" / "2 · Open the show"
   apart; `public/poster.html` (print → PDF, PNG button) carries the new
   `server.staff_token`, which survives "Rotate token".

### D. Preview

8. **Preview must show on the main page toggle even when "off"**, sacrificing
   frames or resolution if needed, or pre-rendering a short beat-synced clip.
   Status: DONE (c220f20), read as: the layer chips on Live had no thumbnail,
   and off layers had none anywhere. The mini bus now renders off-air layers
   on alternate sweeps (lit layers keep 2× refresh, still one extra dispatch
   per frame) and the Live chip shows a dimmed MiniRing.

### E. Windows / GPU

9. **Disable Windows display reconfiguration?** A second monitor got plugged in
   (extra GPU load for base frames), and a flaky USB-C cable connecting and
   disconnecting reset the GPU driver, causing ~0.5 s stutters. Status: DONE
   as far as an app can go (5461cc8): Windows has no supported way to refuse a
   display hot-plug, so `display.rs` watches the topology, logs every change,
   counts GPU re-inits, and banners it — red "flapping cable" at 3 changes in
   10 min — with the fix (pull the extra display). Not done and not possible
   in-app: stopping the reconfiguration itself.
10. **Warn when a low-quality USB-C link is detected.** Evidence was gathered
    over SSH on the live system; encode the detection in code so it works
    without the system online. Status: EVIDENCE IN (see "USB-C evidence" at
    the end, appended 2026-09-11 from camtop). Key finding: what was actually
    observed on 2026-09-06 was a *steady-state degraded link* — a USB-C
    (DisplayPort-external) monitor advertising only ≤1920×1080 while its
    native mode is 2560×1080 — not flapping. That is readable offline: EDID
    detailed timing #1 (registry) vs the largest mode Windows offers
    (EnumDisplaySettingsEx). TDR = System log, provider Display, ID 4101;
    churn = Kernel-PnP 400/410/420/430. Next: implement the degraded-link
    check + TDR counter in `display.rs`; run script §5 on the show machine.
11. **GPU/CPU load histogram/sparkline**, a dismissible toast with details on
    sustained underperformance, and quick load-shedding options (reduce client
    preview frame rate, side render). Status: DONE (4b47535): load sparkline
    (render time as % of the second) on Live + Control; engine-judged
    `load_warning` (85 % load or <85 % of target fps for 8 s) → dismissible
    toast with: cap phone previews at 15 fps (`server.preview_fps_cap`,
    applied live), pause the Ready bus (`render.ready_bus_paused`), render at
    45 fps.

### F. Patch and Ready

12. **Global sidebar indicator of the active patch** (a patch replaces the
    layer stack; only the Patch tab and the Control "Layers" heading know about
    it today). Status: DONE (a457523): PatchChip in the top bar + phone menu.
13. **Patches into the Ready panel.** Ready holds exactly one `SavedStack`
    (layers only); a patch cannot be prepared off-air. Status: DEFERRED with a
    design, not shipped in v0.11.0. Design: `SavedStack` grows
    `patch: Option<PatchDoc>` (a snapshot, not an id, so Take is atomic and a
    later edit to the saved patch does not change what is on Bus B); the Ready
    bus engine compiles it with `set_patch_shader` and runs its own
    `patch::eval::Runtime` (it already owns phases/walks), the Ready tray gets
    a "PATCHES" row next to the scenes, and Take sets `active_patch` instead
    of clearing it. Cost: a second patch runtime + a compile on prepare; the
    engine's `ready_inputs.patch_params = None` guard becomes "the Ready
    runtime's params". About a day; wants its own plan doc.
14. **How many Ready panels? Per-client opt-in? Separate limit?** Today there is
    exactly one global Ready bus with its own GPU engine. Status: DECIDED —
    stays one global bus; private per-client buses only on demand, capped at
    2–3 (see Decisions). Nothing to build now.

### G. Windows and dialogs

15. **Floating fullscreen-exit button and its siblings cover other buttons;
    move them to the topbar.** Status: DONE (e00e10f): floating pills removed;
    the top bar (which stays in show mode) carries Report/Record/toggle, and
    the update control joins it as a compact row.
16. **Duplicate background windows** are easy to open by accident; a toast in
    the visible window should offer to close background windows idle/invisible
    for a few minutes. Status: DONE (bc6af75): `src/windowSentry.ts` —
    heartbeats in shared localStorage; the focused window offers to close
    others idle 5+ min that are hidden or duplicate its tab, 60 s countdown,
    Close now / Keep them (30 min snooze). Unit test via `bun run test:unit`.
17. **Close warning only on the last window.** Closing an extra window must not
    warn if other windows remain; only the last one shows the close guard.
    Status: DONE: `CloseRequested` counts app windows; only the last (main or
    aux) is guarded, and `confirm_close` closes every window.
18. **After the last window closes and the show stops outputting**, show a
    temporary window (self-closes in ~30 s) with one button: "If that was a
    mistake… Restart Show ASAP? Click HERE". Status: DONE: `ExitRequested`
    with `code: None` on a live show is held; `state.close_grace` darkens the
    wire (termination packets go out) while the engine keeps rendering;
    `public/restart.html` (served by our own HTTP server, loopback POSTs to
    `/close-grace/{resume,exit}`) stays up 30 s; resume recreates the main
    window from config and output fades back up. Compile-checked + page
    served; the window flow itself needs a manual desktop run.

### H. No hard cuts, round two (continuing `plans/no-hard-cuts.md`)

19. **Video playback start fades in** (`video_mix` uniform, ~1 s, smoothstepped
    like `game_mix`; shader scales the Video layer's opacity). Stop stays
    instant. Status: DONE (this session).
20. **Game start fades effects and drawing out instead of dropping them**
    (intensity × `1 − game_mix`, dropped only once the world is fully on;
    reverse on stop). Status: DONE (this session).
21. **Ready-bus layer enable toggles ride the same envelope** as Program.
    Status: DONE (this session). Beat-taps enable and full `SetConfig` remain
    instant (not in scope unless cheap).

## Plan / steps

1. [x] Pull, rebase local commits onto origin.
2. [x] Capture every request here.
3. [x] H19–H21 engine fades (one commit, 9d8613c).
4. [x] A2 multitouch fix (one commit).
5. [x] Plans cleanup: delete finished plan docs (own commit), wrap up stale
       progress logs.
6. [x] B3, B4, D8, F12, G15, G17, G18 — landed, one commit each.
7. [x] C5, C6, C7, E9, E11, G16 — landed, one commit each.
8. [ ] F13 (deferred, design above), F14 (open question), E10 (needs the
       SSH evidence).
9. [x] v0.11.0 shipped: release run 34432222155 green on tag v0.11.0
       (= 3478dab), all four assets published (windows-x64.exe, linux-x64,
       linux-x64.AppImage, macos-arm64). The show machine can self-update.

## Findings / gotchas

- Not exercised on real hardware this session (no Gate machine attached):
  the close-grace window flow (G18), the idle-window sentry closing a Tauri
  window (G16), the display watcher seeing an actual hot-plug (E9). All are
  compile-checked and unit-tested where a pure part exists; first show-machine
  run should try each once.
- The `bun run test:unit` (Bun test runner) is not yet in CI's Checks
  workflow; a peer session had `.github/workflows/*.yml` in flight, so it was
  left alone. Add `bun run test:unit` after `bun run typecheck` there.
- Carried over from deleted plans (2026-09-09 cleanup): `show-mode-updates`
  never got a test that drives a real staged-then-install round trip (the mock
  backend has no installer); if update-flow regressions appear, that is the
  gap. `walk-phase-jitter` left two taste questions for the room: is the 2 s
  `DISCRETE_DWELL` right, and is 12:00 local the right hour for the daily
  phase reset (a visible jump on noise layers)?

## Open questions for the user

1. ~~F14 Ready panels~~ — decided 2026-09-10, see Decisions.
2. **E10 USB-C evidence.** Prompt to hand to the earlier agent is below.
3. Carried from `plans/rdp-window-state-corruption.md` (fix landed, doc
   deleted): should show mode re-assert itself when the console session
   returns after an RDP visit? Related to E9.

### Prompt for the USB-C investigation agent

Handed to Cameron 2026-09-10; the answering session appended the "USB-C
evidence" section below on 2026-09-11 (from the camtop checkout). Kept for
the record.

> This is for the USB-C error-detection work on the Empyrean Gate show machine
> (repo: ~/git/Personal Projects/Empyrean). Earlier you SSH'ed into the live
> system (`ssh empyreangate`) and gathered direct evidence of a low-quality /
> flaky USB-C link — display or GPU driver resets, connect/disconnect churn,
> stutters. That evidence never made it into the repo, and I want to encode
> the detection in code so it works without the machine online.
>
> Please append a new section headed "## USB-C evidence" to
> `plans/show-feedback-2026-09.md` in that repo, containing:
>
> 1. The exact commands you ran (PowerShell / cmd / WMI / anything), verbatim.
> 2. The exact output that proved it, verbatim — Windows Event Log source names
>    and event IDs (e.g. Display / nvlddmkm / amdkmdag / igfx / Kernel-PnP / UCM
>    entries), PnP device instance paths, any driver-reset or TDR counters,
>    dxdiag or Get-PnpDevice output, timestamps. Do not summarise; paste.
> 3. For each item, whether a program running on the machine could read the
>    same signal locally with no network (Event Log query, WMI class, registry
>    key, perf counter, Win32 API) — name the specific source.
> 4. Anything you concluded about which cable/port it was and why.
>
> Context for you: the repo already has `src-tauri/src/display.rs`, which
> polls GetSystemMetrics (monitor count, primary size) and flags "flapping"
> at 3 changes in 10 minutes. Your evidence is meant to sharpen that — a
> Windows event or counter that says "link lost / driver reset" directly is
> better than inferring it from topology changes.
>
> Don't change any code. Only append to that plan file, then tell me what you
> added.

## Things not to do

- Don't add config knobs for fade times.
- Don't touch the four version files (package.json, Cargo.toml, Cargo.lock,
  tauri.conf.json) — releases are cut separately.
- Don't use HTML `title=` tooltips anywhere in the new UI.

## USB-C evidence

Appended 2026-09-11 by the session that had SSH access (Fable, session of
2026-09-06). **Read the first paragraph before using anything below.**

**What was and was not gathered.** On 2026-09-06 I SSH'ed into the show
machine (`ssh -i ~/.ssh/empyrean-gate entheos@192.168.1.95`, key set up that
day) while diagnosing two things: the firewall block on port 9520, and
Cameron's report that "the USB-C monitor doesn't have the same resolution it
previously did and Windows won't let me make it higher". I ran WMI/CIM
display queries and a session listing. I did **not** query the Event Log, did
not see driver resets, TDRs, or connect/disconnect churn, and did not measure
stutters. The "flaky cable, GPU re-init, ~0.5 s stalls" incident that
`display.rs` documents was observed by someone else; it is not what I saw.
What I saw was a *steady-state degraded link*: one USB-C monitor, no churn,
advertising a truncated mode list capped at 1920×1080 while its native mode
is 2560×1080. That is a different (and easier) signal than flapping, and it
is readable locally at any time. The "2 DP lanes" explanation below is my
inference from the mode list, not a measured link rate.

On 2026-09-11, when asked for this section, I tried to collect the Event Log
evidence that would complete it. The machine was half-reachable (ping 50 %
loss; TCP to port 22 opened but the SSH banner exchange timed out twice), so
none of section 5 was run. It is pasted verbatim so it can be run next time.

### 1+2. Commands run on 2026-09-06 and their verbatim output

All remote commands were run as `powershell -NoProfile -EncodedCommand <b64>`
over SSH, where `<b64>` is the UTF-16LE base64 of the script shown. Wrapper
used from the laptop (PowerShell 5.1):

```powershell
$script = @'
<script body>
'@
$enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
ssh -i "$env:USERPROFILE\.ssh\empyrean-gate" entheos@192.168.1.95 "powershell -NoProfile -EncodedCommand $enc"
```

(The remote default shell is cmd.exe; nested quoting through it mangles
inline `-Command` strings, hence the encoding.)

**Query 1 — sessions, adapter, monitor identity, connector type.** Script:

```powershell
'--- sessions ---'
qwinsta
'--- video controllers ---'
Get-CimInstance Win32_VideoController | ForEach-Object { "{0} | {1}x{2} | driver {3} | status {4}" -f $_.Name, $_.CurrentHorizontalResolution, $_.CurrentVerticalResolution, $_.DriverVersion, $_.Status }
'--- monitors ---'
Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorID -ErrorAction SilentlyContinue | ForEach-Object { $n = [Text.Encoding]::ASCII.GetString($_.UserFriendlyName[0..($_.UserFriendlyNameLength-1)]); "Monitor: $n (active=$($_.Active))" }
Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorConnectionParams -ErrorAction SilentlyContinue | ForEach-Object { "Connection tech: $($_.VideoOutputTechnology)" }
```

Output, verbatim (CLIXML progress noise stripped):

```
--- sessions ---
 SESSIONNAME               USERNAME                 ID  STATE   TYPE        DEVICE
>services                                            0  Disc
 console                   entheos                   1  Active
 rdp-tcp                                         65536  Listen
--- video controllers ---
Intel(R) Iris(R) Xe Graphics | 1920x1080 | driver 32.0.101.7088 | status OK
--- monitors ---
Monitor: TYPEC         (active=True)
Connection tech: 10
```

**Query 2 — advertised (EDID) mode list and physical size.** Script:

```powershell
$modes = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorListedSupportedSourceModes -ErrorAction SilentlyContinue
foreach ($m in $modes) {
  "Preferred mode index: $($m.PreferredMonitorSourceModeIndex)"
  $m.MonitorSourceModes | ForEach-Object {
    "{0}x{1} @ {2}Hz" -f $_.HorizontalActivePixels, $_.VerticalActivePixels, [math]::Round($_.VerticalRefreshRateNumerator / [math]::Max(1,$_.VerticalRefreshRateDenominator))
  } | Sort-Object -Unique
}
'--- basic display params ---'
Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBasicDisplayParams -ErrorAction SilentlyContinue | ForEach-Object { "MaxH: $($_.MaxHorizontalImageSize)cm MaxV: $($_.MaxVerticalImageSize)cm" }
```

Output, verbatim:

```
Preferred mode index: 4
1024x768 @ 60Hz
1280x720 @ 60Hz
1280x800 @ 60Hz
1280x960 @ 60Hz
1440x900 @ 60Hz
1680x1050 @ 60Hz
1920x1080 @ 60Hz
640x480 @ 60Hz
800x600 @ 60Hz
800x600 @ 64Hz
--- basic display params ---
MaxH: 37cm MaxV: 14cm
```

(The list went through `Sort-Object -Unique`, so "preferred index 4" does not
map to a line above; the raw array order was not captured.)

**What in that output is the evidence.**

- `Connection tech: 10` is `D3DKMDT_VOT_DISPLAYPORT_EXTERNAL` — the monitor is
  on DisplayPort, external, i.e. USB-C DP alt-mode (the monitor self-identifies
  as "TYPEC").
- `MaxH: 37cm MaxV: 14cm` is a ~2.6:1 panel. Every mode in the list is 4:3,
  16:10 or 16:9, and the tallest is 1920×1080. The panel's native mode
  (2560×1080 — see `plans/empyrean-gate.md` line ~331, "at 2560x1080 items
  sat…", from when this same display ran at full res) is **absent**. A
  monitor that advertises only VESA standard timings and omits its own
  detailed timing is either returning a fallback EDID or — the common USB-C
  case — deliberately advertising what the negotiated link can carry.
- Bandwidth check behind the inference: 1920×1080@60 needs ≈3.7 Gbit/s of
  payload; 2560×1080@60 needs ≈5.0. Two DP lanes at HBR (2×2.7 Gbit/s, 8b/10b)
  carry ≈4.3 usable. Two lanes fit exactly the list above and not the native
  mode. Four lanes (or 2×HBR2) would carry 2560×1080 easily. Hence "link is
  running 2 lanes" — inferred, not measured.
- `console … Active` rules out an RDP session holding the console at a
  virtual resolution (the failure `plans/rdp-window-state-corruption.md`
  described).
- Adapter status `OK`, one monitor, and no topology change during the
  session: no churn was present while I looked.

### 3. Can a program on the machine read each signal locally, offline?

Yes for every item above. All were read over an *elevated* SSH session; the
non-elevated claims are marked.

| Signal | Local source (no network) | Elevation |
|---|---|---|
| Console vs RDP session (`qwinsta`) | `GetSystemMetrics(SM_REMOTESESSION)` — already in `src-tauri/src/session.rs`; or `WTSEnumerateSessionsW` (wtsapi32) | none |
| Adapter name, current mode, driver version (`Win32_VideoController`) | WMI `root\cimv2` `Win32_VideoController`; or `EnumDisplayDevicesW` + `EnumDisplaySettingsExW(name, ENUM_CURRENT_SETTINGS)` (user32) | none |
| Monitor friendly name (`WmiMonitorID.UserFriendlyName`) | `QueryDisplayConfig` + `DisplayConfigGetDeviceInfo(DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME)` → `monitorFriendlyDeviceName` (user32); or raw EDID bytes at `HKLM\SYSTEM\CurrentControlSet\Enum\DISPLAY\<PnP id>\<instance>\Device Parameters\EDID` (REG_BINARY, readable by standard users) | none via Win32/registry; the WMI `root\wmi` monitor classes I used should be verified from a non-elevated process — I only ran them elevated |
| Connector type (`WmiMonitorConnectionParams.VideoOutputTechnology` = 10) | Same `DISPLAYCONFIG_TARGET_DEVICE_NAME.outputTechnology` (value 10 = `DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EXTERNAL`) | none |
| Advertised mode list (`WmiMonitorListedSupportedSourceModes`) | `EnumDisplaySettingsExW(name, iModeNum++)` loop gives every mode Windows will offer; the monitor's *own* native mode is EDID detailed timing #1 (bytes 54–71 of the registry EDID blob: h-active = byte 56 + ((byte 58 & 0xF0) << 4), v-active = byte 59 + ((byte 61 & 0xF0) << 4)) | none |
| Physical size (`WmiMonitorBasicDisplayParams`) | EDID bytes 21 (h cm) and 22 (v cm) from the same registry blob | none |

The sharpening this enables in `display.rs`, without any event log: on
start and on every topology change, for each active target, compare the
largest mode Windows offers (`EnumDisplaySettingsEx` max) against the
EDID's detailed-timing #1. If the EDID's native is larger than anything
offered — or the EDID has no detailed timing at all while `outputTechnology`
is DisplayPort-external — the link is degraded. That is a steady-state check
that fires even when the cable is *not* flapping, which is exactly the state
the machine was in on 2026-09-06.

### 4. Which cable / port

Not determined. I had no data on which physical port the monitor was in or
which cable was used, and could not compare against a known-good state; the
only fact is that the display Windows calls "TYPEC" on a DisplayPort-external
target was offering ≤1920×1080. The advice given to Cameron was physical:
reseat and flip the USB-C plug, use the full-featured cable with no hub in
the path, check the monitor OSD for a "USB data priority / USB 3.0" mode that
steals two DP lanes, then power-cycle the monitor to renegotiate. Whether any
of that fixed it is not recorded here.

### 5. Collection script for the missing event evidence (not yet run)

This is what I attempted on 2026-09-11 and could not complete. Run it with
the wrapper above the next time the machine is reachable and paste the
output under a "### 5. Results" heading. It is read-only. The System log is
readable without elevation; the `*-DxgKrnl*` operational logs may need
enabling and elevation.

```powershell
$since = (Get-Date).AddDays(-14)
'=== A. Display / DxgKrnl / igfx events (System log, last 14 days) ==='
Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName=@('Display','Microsoft-Windows-DxgKrnl','igfx','igfxn'); StartTime=$since} -ErrorAction SilentlyContinue |
  Sort-Object TimeCreated | ForEach-Object { "{0:yyyy-MM-dd HH:mm:ss} | {1} | id {2} | {3}" -f $_.TimeCreated, $_.ProviderName, $_.Id, ($_.Message -replace "`r?`n",' ' ) }
'=== B. Kernel-PnP events mentioning DISPLAY/MONITOR/USB4/UCM/TypeC (last 14 days) ==='
Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-Kernel-PnP'; StartTime=$since} -ErrorAction SilentlyContinue |
  Where-Object { $_.Message -match 'DISPLAY|MONITOR|USB4|UCM|UcmCx|TypeC|Type-C|USBHUB3' } |
  Sort-Object TimeCreated | ForEach-Object { "{0:yyyy-MM-dd HH:mm:ss} | id {1} | {2}" -f $_.TimeCreated, $_.Id, ($_.Message -replace "`r?`n",' ') }
'=== C. UCM / USB4 / xHCI / Thunderbolt provider events (last 14 days) ==='
Get-WinEvent -FilterHashtable @{LogName='System'; StartTime=$since} -ErrorAction SilentlyContinue |
  Where-Object { $_.ProviderName -match 'Ucm|USB4|UsbHub3|USBXHCI|Thunderbolt' } |
  Sort-Object TimeCreated | ForEach-Object { "{0:yyyy-MM-dd HH:mm:ss} | {1} | id {2} | {3}" -f $_.TimeCreated, $_.ProviderName, $_.Id, ($_.Message -replace "`r?`n",' ') }
'=== D. Operational logs present for Type-C / DisplayPort / DxgKrnl ==='
Get-WinEvent -ListLog '*Ucm*','*USB4*','*DxgKrnl*','*Display*','*Type-C*','*Kernel-PnP*' -ErrorAction SilentlyContinue | ForEach-Object { "{0} | enabled={1} | records={2}" -f $_.LogName, $_.IsEnabled, $_.RecordCount }
'=== E. PnP devices: Monitor / Display / USB-C / USB4 ==='
Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.Class -in @('Monitor','Display','UCM','USB4') -or $_.FriendlyName -match 'Type-C|USB4|Thunderbolt|Connector' } |
  Sort-Object Class | ForEach-Object { "{0} | {1} | {2} | {3}" -f $_.Class, $_.Status, $_.FriendlyName, $_.InstanceId }
'=== F. Current monitor/EDID state (re-run of the 2026-09-06 queries) ==='
Get-CimInstance Win32_VideoController | ForEach-Object { "{0} | {1}x{2} | driver {3} | status {4}" -f $_.Name, $_.CurrentHorizontalResolution, $_.CurrentVerticalResolution, $_.DriverVersion, $_.Status }
Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorID -ErrorAction SilentlyContinue | ForEach-Object { $n = [Text.Encoding]::ASCII.GetString($_.UserFriendlyName[0..($_.UserFriendlyNameLength-1)]); "Monitor: $n (active=$($_.Active)) InstanceName=$($_.InstanceName)" }
Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorConnectionParams -ErrorAction SilentlyContinue | ForEach-Object { "Connection tech: $($_.VideoOutputTechnology)" }
$modes = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorListedSupportedSourceModes -ErrorAction SilentlyContinue
foreach ($m in $modes) { "Preferred mode index: $($m.PreferredMonitorSourceModeIndex)"; $m.MonitorSourceModes | ForEach-Object { "{0}x{1} @ {2}Hz" -f $_.HorizontalActivePixels, $_.VerticalActivePixels, [math]::Round($_.VerticalRefreshRateNumerator / [math]::Max(1,$_.VerticalRefreshRateDenominator)) } | Sort-Object -Unique }
Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBasicDisplayParams -ErrorAction SilentlyContinue | ForEach-Object { "MaxH: $($_.MaxHorizontalImageSize)cm MaxV: $($_.MaxVerticalImageSize)cm" }
'=== G. TDR policy values (HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers) ==='
Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' -ErrorAction SilentlyContinue | Select-Object Tdr* | Format-List | Out-String
'=== H. Uptime ==='
"Last boot: {0:yyyy-MM-dd HH:mm:ss}  Now: {1:yyyy-MM-dd HH:mm:ss}" -f (Get-CimInstance Win32_OperatingSystem).LastBootUpTime, (Get-Date)
```

What to look for in its output, and the local reader for each (these are
the standard Windows signals for "link lost / driver reset"; **none has been
confirmed present on this machine yet**):

- System log, provider `Display`, **Event ID 4101** ("Display driver … stopped
  responding and has successfully recovered") — a TDR, i.e. the GPU reset
  that `display.rs` currently infers. Local reader: `EvtQuery`/`EvtNext`
  (wevtapi) or `EvtSubscribe` for push, on channel `System`, XPath
  `*[System[Provider[@Name='Display'] and EventID=4101]]`. No elevation.
- System log, provider `Microsoft-Windows-Kernel-PnP`, **IDs 400/410/420/430**
  whose message names a `DISPLAY\…` or `USB4\…`/`UCM…` instance path — the
  connect/disconnect churn with exact timestamps. Same reader; no elevation.
- Provider names matching `Ucm*` / `USB4*` / `UsbHub3` in System — connector
  state changes for the USB-C port itself. Same reader.
- `Microsoft-Windows-DxgKrnl-*` operational channels (section D lists whether
  they exist and are enabled) — per-adapter reset/reinit detail. Usually
  disabled; enabling needs elevation.
- Push alternative to polling `GetSystemMetrics`: a hidden window handling
  `WM_DISPLAYCHANGE`, plus `RegisterDeviceNotificationW` with
  `GUID_DEVINTERFACE_MONITOR` for `WM_DEVICECHANGE` arrive/remove — gives the
  same topology events `display.rs` polls for, at the instant they happen.
